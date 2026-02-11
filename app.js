// ============================================================
// Pod Dashboard — AAA Accelerator
// ============================================================

// --- CONFIG ---
// Replace these with your Supabase project credentials
const SUPABASE_URL = 'https://jngaimwmdntcydqefryt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IIWDOFGb41BZC9J8XS-BAA_YiO1FQMv';
const PASSWORD_HASH = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'; // Default: "password" — change this!

let supabase;
let currentMeetingId = null;
let members = [];
let topicFilter = 'open';

// --- AUTH ---
function sha256(str) {
  const buf = new TextEncoder().encode(str);
  return crypto.subtle.digest('SHA-256', buf).then(h => {
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

async function attemptLogin() {
  const pw = document.getElementById('password-input').value;
  const hash = await sha256(pw);
  if (hash === PASSWORD_HASH) {
    sessionStorage.setItem('pod_auth', '1');
    showDashboard();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

document.getElementById('password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') attemptLogin();
});

function logout() {
  sessionStorage.removeItem('pod_auth');
  location.reload();
}

function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  init();
}

// --- INIT ---
async function init() {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await loadMembers();
  await loadMeetings();
  setupPasteZone();
  setupRealtimeSubscriptions();
}

// --- MEMBERS ---
async function loadMembers() {
  const { data } = await supabase.from('members').select('*').order('name');
  members = data || [];
  populateCheckinMemberSelect();
}

function populateCheckinMemberSelect() {
  const sel = document.getElementById('checkin-member');
  sel.innerHTML = '<option value="">Kies naam...</option>' +
    members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

// --- MEETINGS ---
async function loadMeetings() {
  const { data } = await supabase.from('meetings').select('*').order('date', { ascending: false });
  const sel = document.getElementById('meeting-selector');
  if (!data || data.length === 0) {
    sel.innerHTML = '<option>Geen meetings</option>';
    return;
  }
  sel.innerHTML = data.map(m =>
    `<option value="${m.id}">${formatDate(m.date)}${m.title ? ' — ' + m.title : ''}</option>`
  ).join('');
  currentMeetingId = data[0].id;
  await loadAllForMeeting();
}

async function switchMeeting() {
  currentMeetingId = document.getElementById('meeting-selector').value;
  await loadAllForMeeting();
}

async function createNewMeeting() {
  const title = prompt('Meeting titel (optioneel):') || '';
  const dateStr = prompt('Datum (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
  if (!dateStr) return;
  const { data } = await supabase.from('meetings').insert({ date: dateStr, title, summary: '' }).select().single();
  if (data) {
    // Auto-create attendance records for all members
    const attendanceRows = members.map(m => ({ meeting_id: data.id, member_id: m.id, present: false }));
    if (attendanceRows.length) await supabase.from('attendance').insert(attendanceRows);
    await loadMeetings();
  }
}

async function loadAllForMeeting() {
  if (!currentMeetingId) return;
  await Promise.all([
    loadAgenda(),
    loadAttendance(),
    loadTopics(),
    loadCheckins(),
    loadSummary()
  ]);
}

// --- AGENDA ---
async function loadAgenda() {
  const { data } = await supabase.from('agenda_items')
    .select('*').eq('meeting_id', currentMeetingId).order('position');
  const container = document.getElementById('agenda-items');
  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Nog geen agendapunten</p>';
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
  const { data: existing } = await supabase.from('agenda_items')
    .select('position').eq('meeting_id', currentMeetingId).order('position', { ascending: false }).limit(1);
  const pos = existing && existing.length ? existing[0].position + 1 : 0;
  await supabase.from('agenda_items').insert({ meeting_id: currentMeetingId, text, duration_min: dur, position: pos });
  document.getElementById('new-agenda-text').value = '';
  await loadAgenda();
}

async function deleteAgendaItem(id) {
  await supabase.from('agenda_items').delete().eq('id', id);
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
      // Swap positions
      const { data: all } = await supabase.from('agenda_items')
        .select('id,position').eq('meeting_id', currentMeetingId).order('position');
      const ids = all.map(a => a.id);
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(targetId);
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedId);
      for (let i = 0; i < ids.length; i++) {
        await supabase.from('agenda_items').update({ position: i }).eq('id', ids[i]);
      }
      await loadAgenda();
    });
  });
}

// --- ATTENDANCE ---
async function loadAttendance() {
  const { data } = await supabase.from('attendance')
    .select('*, members(name)').eq('meeting_id', currentMeetingId);
  const container = document.getElementById('attendance-list');

  if (!data || data.length === 0) {
    // If no attendance records, create them
    if (members.length && currentMeetingId) {
      const rows = members.map(m => ({ meeting_id: currentMeetingId, member_id: m.id, present: false }));
      await supabase.from('attendance').insert(rows);
      return loadAttendance();
    }
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Geen leden</p>';
    return;
  }

  const present = data.filter(d => d.present).length;
  container.innerHTML = data.map(a => `
    <div class="member-row">
      <span class="member-name">${esc(a.members?.name || '?')}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="attendance-stats">${a.present ? '✓' : ''}</span>
        <button class="attendance-toggle ${a.present ? 'present' : 'absent'}"
          onclick="toggleAttendance('${a.id}', ${!a.present})"></button>
      </div>
    </div>
  `).join('') + `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">${present}/${data.length} aanwezig</div>`;
}

async function toggleAttendance(id, val) {
  await supabase.from('attendance').update({ present: val }).eq('id', id);
  await loadAttendance();
}

// --- TOPICS ---
async function loadTopics() {
  let query = supabase.from('topics').select('*').order('created_at', { ascending: false });
  if (topicFilter === 'open') query = query.eq('discussed', false);
  else query = query.eq('discussed', true);

  const { data } = await query;
  const container = document.getElementById('topics-list');

  if (!data || data.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">${topicFilter === 'open' ? 'Geen open onderwerpen' : 'Nog niks besproken'}</p>`;
    return;
  }

  container.innerHTML = data.map(t => `
    <div class="topic-item">
      <div class="topic-checkbox ${t.discussed ? 'checked' : ''}"
        onclick="toggleTopic('${t.id}', ${!t.discussed})"></div>
      <div>
        <div class="topic-text ${t.discussed ? 'discussed' : ''}">${esc(t.text)}</div>
        <div class="topic-by">${esc(t.added_by || '')}${t.meeting_id ? ' • voor meeting' : ''}</div>
      </div>
      <span class="delete-btn" onclick="deleteTopic('${t.id}')" style="margin-left:auto;">×</span>
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
  const by = document.getElementById('new-topic-by').value.trim();
  if (!text) return;
  await supabase.from('topics').insert({ text, added_by: by, discussed: false, meeting_id: null });
  document.getElementById('new-topic-text').value = '';
  document.getElementById('new-topic-by').value = '';
  await loadTopics();
}

async function toggleTopic(id, val) {
  await supabase.from('topics').update({ discussed: val, meeting_id: val ? currentMeetingId : null }).eq('id', id);
  await loadTopics();
}

async function deleteTopic(id) {
  await supabase.from('topics').delete().eq('id', id);
  await loadTopics();
}

// --- CHECK-INS ---
async function loadCheckins() {
  const { data } = await supabase.from('checkins')
    .select('*, members(name)').eq('meeting_id', currentMeetingId).order('created_at');
  const container = document.getElementById('checkin-list');

  if (!data || data.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Nog geen check-ins</p>';
    return;
  }

  container.innerHTML = data.map(c => `
    <div class="checkin-entry">
      <h3>${esc(c.members?.name || 'Onbekend')}</h3>
      ${c.goals ? `<div class="field"><div class="field-label">🎯 Doelen</div>${esc(c.goals)}</div>` : ''}
      ${c.progress ? `<div class="field"><div class="field-label">📈 Progressie</div>${esc(c.progress)}</div>` : ''}
      ${c.challenges ? `<div class="field"><div class="field-label">⚡ Uitdagingen</div>${esc(c.challenges)}</div>` : ''}
      ${c.support ? `<div class="field"><div class="field-label">🤝 Hulp nodig</div>${esc(c.support)}</div>` : ''}
      ${c.screenshot_url ? `<img src="${c.screenshot_url}" alt="Check-in screenshot">` : ''}
    </div>
  `).join('');
}

let pastedImageBase64 = null;

function setupPasteZone() {
  const zone = document.getElementById('paste-zone');
  zone.addEventListener('click', () => zone.focus());
  zone.setAttribute('tabindex', '0');
  zone.addEventListener('paste', e => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = ev => {
          pastedImageBase64 = ev.target.result;
          document.getElementById('checkin-preview').src = pastedImageBase64;
          document.getElementById('checkin-preview').classList.remove('hidden');
          zone.textContent = '✅ Screenshot geplakt!';
          zone.classList.add('active');
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  });
}

async function submitCheckin() {
  const memberId = document.getElementById('checkin-member').value;
  if (!memberId) { alert('Kies eerst een naam'); return; }

  const goals = document.getElementById('checkin-goals').value.trim();
  const progress = document.getElementById('checkin-progress').value.trim();
  const challenges = document.getElementById('checkin-challenges').value.trim();
  const support = document.getElementById('checkin-support').value.trim();

  let screenshotUrl = null;
  if (pastedImageBase64) {
    // Upload to Supabase Storage
    const blob = await (await fetch(pastedImageBase64)).blob();
    const filename = `checkin_${currentMeetingId}_${memberId}_${Date.now()}.png`;
    const { data: upload } = await supabase.storage.from('checkins').upload(filename, blob, { contentType: 'image/png' });
    if (upload) {
      const { data: urlData } = supabase.storage.from('checkins').getPublicUrl(filename);
      screenshotUrl = urlData.publicUrl;
    }
  }

  await supabase.from('checkins').insert({
    meeting_id: currentMeetingId,
    member_id: memberId,
    goals, progress, challenges, support,
    screenshot_url: screenshotUrl
  });

  // Reset form
  document.getElementById('checkin-goals').value = '';
  document.getElementById('checkin-progress').value = '';
  document.getElementById('checkin-challenges').value = '';
  document.getElementById('checkin-support').value = '';
  pastedImageBase64 = null;
  document.getElementById('checkin-preview').classList.add('hidden');
  document.getElementById('paste-zone').textContent = '📋 Klik hier en plak (Ctrl+V) een screenshot van je check-in';
  document.getElementById('paste-zone').classList.remove('active');

  await loadCheckins();
}

// --- SUMMARY ---
async function loadSummary() {
  // Load previous meeting's summary
  const { data: meetings } = await supabase.from('meetings')
    .select('*').order('date', { ascending: false }).limit(2);
  const el = document.getElementById('prev-summary');
  if (meetings && meetings.length > 1) {
    el.innerHTML = meetings[1].summary || '';
    el.dataset.meetingId = meetings[1].id;
  } else if (meetings && meetings.length === 1) {
    el.innerHTML = meetings[0].summary || '';
    el.dataset.meetingId = meetings[0].id;
  }
}

async function saveSummary() {
  const el = document.getElementById('prev-summary');
  const meetingId = el.dataset.meetingId;
  if (!meetingId) return;
  await supabase.from('meetings').update({ summary: el.innerHTML }).eq('id', meetingId);
  // Brief visual feedback
  const btn = document.querySelector('.save-summary');
  btn.textContent = '✓ Opgeslagen';
  setTimeout(() => btn.textContent = 'Opslaan', 1500);
}

// --- REALTIME ---
function setupRealtimeSubscriptions() {
  supabase.channel('all-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_items' }, () => loadAgenda())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => loadAttendance())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'topics' }, () => loadTopics())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => loadCheckins())
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
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// --- AUTO LOGIN CHECK ---
if (sessionStorage.getItem('pod_auth') === '1') {
  showDashboard();
}
