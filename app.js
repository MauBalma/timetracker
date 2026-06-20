import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://toxjxdbpmonzejdkcabt.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_56xhxWo5aqu5Wwirhl9YHA_ah2jthil'

const FORGOT_TO_STOP_HOURS = 12

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const $ = (id) => document.getElementById(id)
const signedOut = $('signed-out')
const signedIn  = $('signed-in')
const userLabel = $('user-label')
const statusEl  = $('status')
const warningEl = $('warning')
const errorEl   = $('error')
const startBtn  = $('start')
const stopBtn   = $('stop')
const signInBtn = $('sign-in')
const signOutBtn = $('sign-out')
const addSessionBtn = $('add-session')
const sessionsBody = $('sessions-body')
const weekHeaders = $('week-headers')
const weekBody = $('week-body')
const weekScroll = $('week-scroll')
const weekLabel = $('week-label')
const weekPrevBtn = $('week-prev')
const weekNextBtn = $('week-next')
const weekTodayBtn = $('week-today')
const teamTogglesEl = $('team-toggles')
const teamStatsCard = $('team-stats-card')
const teamPie = $('team-pie')
const teamLegend = $('team-legend')
const periodTabs = $('period-tabs')
const excludeMeToggle = $('exclude-me-toggle')
const datesList = $('dates-list')
const addDateBtn = $('add-date')

const PX_PER_HOUR = 40
const PX_PER_MIN = PX_PER_HOUR / 60
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const USER_HUES = [220, 145, 30, 280, 350, 195, 95, 320]

let openSession = null
let mySessions = []
let teamSessions = []
let warningTimer = null
let editingId = null
let addingNew = false
let weekOffset = 0
let weekInitialScrollDone = false
let myUserId = null
let isAdmin = false
let users = []
let enabledUsers = new Set()
let teamPeriod = 'week'
let excludeSelf = false
let milestones = []
let editingDateId = null
let addingDate = false

function showError(msg) {
  errorEl.textContent = msg ?? ''
}

function setBusy(busy) {
  startBtn.disabled = busy || !!openSession
  stopBtn.disabled  = busy || !openSession
}

async function loadSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, started_at, ended_at, user_id')
    .order('started_at', { ascending: false })

  if (error) {
    showError(error.message)
    return
  }

  teamSessions = data
  mySessions = data.filter((s) => s.user_id === myUserId)
  openSession = mySessions.find((s) => s.ended_at === null) ?? null
  renderTotals()
  renderRunningState()
  renderSessions()
  renderWeek()
  renderTeamPie()
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfWeek() {
  // Monday as week start
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const offset = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - offset)
  return d.getTime()
}

function startOfMonth() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d.getTime()
}

function clippedMs(session, windowStart, windowEnd) {
  const start = new Date(session.started_at).getTime()
  const end = session.ended_at
    ? new Date(session.ended_at).getTime()
    : Date.now()
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart))
}

function sumMs(windowStart, windowEnd) {
  return mySessions.reduce(
    (acc, s) => acc + clippedMs(s, windowStart, windowEnd),
    0
  )
}

function renderTotals() {
  const upper = Date.now() + 1000
  $('total-today').textContent = formatElapsed(sumMs(startOfToday(), upper))
  $('total-week').textContent  = formatElapsed(sumMs(startOfWeek(),  upper))
  $('total-month').textContent = formatElapsed(sumMs(startOfMonth(), upper))
  $('total-all').textContent   = formatElapsed(sumMs(0,              upper))
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function renderRunningState() {
  clearInterval(warningTimer)
  warningEl.style.display = 'none'

  if (openSession) {
    const started = new Date(openSession.started_at)
    startBtn.disabled = true
    stopBtn.disabled  = false

    let lastMinute = -1
    const tick = () => {
      const now = new Date()
      const elapsedMs = now.getTime() - started.getTime()
      statusEl.textContent =
        `Running for ${formatElapsed(elapsedMs)} (since ${started.toLocaleString()})`
      const hours = elapsedMs / 3600000
      if (hours >= FORGOT_TO_STOP_HOURS) {
        warningEl.textContent =
          `Running for ${hours.toFixed(1)}h — did you forget to stop?`
        warningEl.style.display = 'block'
      }
      renderTotals()
      const m = now.getMinutes()
      if (m !== lastMinute) {
        lastMinute = m
        renderWeek()
        renderTeamPie()
      } else {
        renderNowLine()
      }
    }
    tick()
    warningTimer = setInterval(tick, 1000)
  } else {
    statusEl.textContent = 'Not running'
    startBtn.disabled = false
    stopBtn.disabled  = true
  }
}

// --- Date/time editor -------------------------------------------------------
// Native <input type="datetime-local"> is inconsistent across browsers: on
// Firefox the pop-up only edits the date (time must be typed into fields many
// users never find), and whether AM/PM shows at all is dictated by the OS
// locale, not the page. So we build the editor from explicit controls: a
// native date picker plus 12-hour hour/minute/second number fields and an
// AM/PM select. This guarantees an editable, AM/PM time in every browser.

function dtParts(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  const h24 = d.getHours()
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hour: h12,
    min: d.getMinutes(),
    sec: d.getSeconds(),
    ampm: h24 < 12 ? 'AM' : 'PM'
  }
}

function dateTimeEditor(field, iso) {
  const p = dtParts(iso ?? new Date().toISOString())
  const pad = (n) => String(n).padStart(2, '0')
  return `<span class="dt-edit" data-field="${field}">
      <input type="date" class="dt-date" data-dt="date" value="${p.date}">
      <span class="dt-time">
        <input type="number" class="dt-num" data-dt="hour" min="1" max="12" value="${p.hour}">
        <span class="dt-sep">:</span>
        <input type="number" class="dt-num" data-dt="min" min="0" max="59" value="${pad(p.min)}">
        <span class="dt-sep">:</span>
        <input type="number" class="dt-num" data-dt="sec" min="0" max="59" value="${pad(p.sec)}">
        <select class="dt-ampm" data-dt="ampm">
          <option${p.ampm === 'AM' ? ' selected' : ''}>AM</option>
          <option${p.ampm === 'PM' ? ' selected' : ''}>PM</option>
        </select>
      </span>
    </span>`
}

// Read one .dt-edit group back into an ISO string, or null if invalid/empty.
function readDateTime(scope) {
  if (!scope) return null
  const dateStr = scope.querySelector('[data-dt="date"]').value
  let hour = parseInt(scope.querySelector('[data-dt="hour"]').value, 10)
  const min = parseInt(scope.querySelector('[data-dt="min"]').value, 10)
  const sec = parseInt(scope.querySelector('[data-dt="sec"]').value, 10) || 0
  const ampm = scope.querySelector('[data-dt="ampm"]').value
  if (!dateStr || isNaN(hour) || isNaN(min)) return null
  if (hour < 1 || hour > 12 || min < 0 || min > 59 || sec < 0 || sec > 59) return null
  if (ampm === 'PM' && hour !== 12) hour += 12
  if (ampm === 'AM' && hour === 12) hour = 0
  const [y, mo, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, mo - 1, d, hour, min, sec)
  return isNaN(dt.getTime()) ? null : dt.toISOString()
}

const sessionDateFmt = new Intl.DateTimeFormat(undefined, {
  year: '2-digit', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: '2-digit'
})
function formatLocal(iso) {
  return sessionDateFmt.format(new Date(iso))
}

function durationText(session) {
  if (!session.ended_at) return 'running'
  const ms = new Date(session.ended_at) - new Date(session.started_at)
  return formatElapsed(ms)
}

function renderSessions() {
  sessionsBody.innerHTML = ''

  if (addingNew) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${dateTimeEditor('start', null)}</td>
      <td>${dateTimeEditor('end', null)}</td>
      <td>—</td>
      <td class="actions">
        <button class="small primary" data-action="save-new">Save</button>
        <button class="small" data-action="cancel-new">Cancel</button>
      </td>`
    sessionsBody.appendChild(tr)
  }

  for (const s of mySessions) {
    const tr = document.createElement('tr')
    const isRunning = s.ended_at === null
    if (editingId === s.id) {
      tr.innerHTML = `
        <td>${dateTimeEditor('start', s.started_at)}</td>
        <td>${
          isRunning
            ? '<em title="Use the Stop button to close this session">(running)</em>'
            : dateTimeEditor('end', s.ended_at)
        }</td>
        <td>${durationText(s)}</td>
        <td class="actions">
          <button class="small primary" data-action="save"   data-id="${s.id}">Save</button>
          <button class="small"         data-action="cancel" data-id="${s.id}">Cancel</button>
        </td>`
    } else {
      tr.innerHTML = `
        <td>${formatLocal(s.started_at)}${isRunning ? '<span class="running-tag">running</span>' : ''}</td>
        <td>${isRunning ? '—' : formatLocal(s.ended_at)}</td>
        <td>${durationText(s)}</td>
        <td class="actions">
          <button class="small" data-action="edit"   data-id="${s.id}">Edit</button>
          <button class="small danger" data-action="delete" data-id="${s.id}">Delete</button>
        </td>`
    }
    sessionsBody.appendChild(tr)
  }
}

sessionsBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]')
  if (!btn) return
  const action = btn.dataset.action
  const id = btn.dataset.id

  if (action === 'edit') {
    editingId = id
    renderSessions()
    return
  }
  if (action === 'cancel') {
    editingId = null
    renderSessions()
    return
  }
  if (action === 'cancel-new') {
    addingNew = false
    renderSessions()
    return
  }
  if (action === 'save') {
    const row = btn.closest('tr')
    const endScope = row.querySelector('.dt-edit[data-field="end"]')
    const startIso = readDateTime(row.querySelector('.dt-edit[data-field="start"]'))
    const endIso = readDateTime(endScope)
    if (!startIso) { showError('Enter a valid start date and time.'); return }
    if (endScope && !endIso) { showError('Enter a valid end date and time.'); return }
    if (endIso && new Date(endIso) < new Date(startIso)) {
      showError('End must be on or after start.'); return
    }
    showError('')
    const patch = endScope
      ? { started_at: startIso, ended_at: endIso }
      : { started_at: startIso }
    const { error } = await supabase.from('sessions').update(patch).eq('id', id)
    if (error) { showError(error.message); return }
    editingId = null
    await loadSessions()
    return
  }
  if (action === 'delete') {
    if (!confirm('Delete this session?')) return
    showError('')
    const { error } = await supabase.from('sessions').delete().eq('id', id)
    if (error) { showError(error.message); return }
    if (editingId === id) editingId = null
    await loadSessions()
    return
  }
  if (action === 'save-new') {
    const row = btn.closest('tr')
    const startIso = readDateTime(row.querySelector('.dt-edit[data-field="start"]'))
    const endIso   = readDateTime(row.querySelector('.dt-edit[data-field="end"]'))
    if (!startIso) { showError('Enter a valid start date and time.'); return }
    if (!endIso)   { showError('Enter a valid end date and time.'); return }
    if (new Date(endIso) < new Date(startIso)) {
      showError('End must be on or after start.'); return
    }
    showError('')
    const { error } = await supabase
      .from('sessions')
      .insert({ started_at: startIso, ended_at: endIso })
    if (error) { showError(error.message); return }
    addingNew = false
    await loadSessions()
    return
  }
})

addSessionBtn.addEventListener('click', () => {
  addingNew = true
  renderSessions()
})

function startOfWeekFor(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const offset = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - offset)
  return d
}

function weekStartDate() {
  const d = startOfWeekFor(new Date())
  d.setDate(d.getDate() + weekOffset * 7)
  return d
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
}

function splitSessionByDay(session, windowStart, windowEnd) {
  const start = new Date(session.started_at)
  const end = session.ended_at ? new Date(session.ended_at) : new Date()
  const s = start < windowStart ? new Date(windowStart) : start
  const e = end > windowEnd ? new Date(windowEnd) : end
  if (e <= s) return []
  const out = []
  let cursor = new Date(s)
  while (cursor < e) {
    const nextMidnight = new Date(cursor)
    nextMidnight.setHours(24, 0, 0, 0)
    const segEnd = nextMidnight < e ? nextMidnight : e
    out.push({ start: new Date(cursor), end: segEnd })
    cursor = nextMidnight
  }
  return out
}

function buildWeekStaticBody() {
  if (weekBody.childElementCount > 0) return
  const axis = document.createElement('div')
  axis.className = 'time-axis'
  for (let h = 1; h < 24; h++) {
    const lbl = document.createElement('div')
    lbl.className = 'hour-label'
    lbl.style.top = `${h * PX_PER_HOUR}px`
    const hour12 = ((h + 11) % 12) + 1
    const ampm = h < 12 ? 'AM' : 'PM'
    lbl.textContent = `${hour12} ${ampm}`
    axis.appendChild(lbl)
  }
  weekBody.appendChild(axis)
  for (let i = 0; i < 7; i++) {
    const col = document.createElement('div')
    col.className = 'day-column'
    col.dataset.dow = String(i)
    weekBody.appendChild(col)
  }
}

function renderWeek() {
  buildWeekStaticBody()
  const weekStart = weekStartDate()
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)
  const now = new Date()

  const headerFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  const lastDay = new Date(weekEnd.getTime() - 1)
  weekLabel.textContent = `${headerFmt.format(weekStart)} – ${headerFmt.format(lastDay)}`

  weekHeaders.innerHTML = ''
  const gutter = document.createElement('div')
  gutter.className = 'gutter'
  weekHeaders.appendChild(gutter)
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart)
    day.setDate(weekStart.getDate() + i)
    const h = document.createElement('div')
    h.className = 'day-header'
    if (isSameDay(day, now)) h.classList.add('today')
    h.innerHTML = `${DAY_LABELS[i]}<span class="dnum">${day.getDate()}</span>`
    weekHeaders.appendChild(h)
  }

  const dayColumns = weekBody.querySelectorAll('.day-column')
  dayColumns.forEach((col, idx) => {
    col.innerHTML = ''
    const day = new Date(weekStart)
    day.setDate(weekStart.getDate() + idx)
    col.classList.toggle('today', isSameDay(day, now))
  })

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  for (const s of teamSessions) {
    if (isAdmin && !enabledUsers.has(s.user_id)) continue
    const isRunning = s.ended_at === null
    const isMine = s.user_id === myUserId
    const segments = splitSessionByDay(s, weekStart, weekEnd)
    for (const seg of segments) {
      const segDay = new Date(seg.start)
      segDay.setHours(0, 0, 0, 0)
      const dayIdx = Math.round((segDay - weekStart) / 86400000)
      if (dayIdx < 0 || dayIdx > 6) continue
      const topMin = (seg.start - segDay) / 60000
      const heightMin = Math.max((seg.end - seg.start) / 60000, 0.5)
      const block = document.createElement('div')
      let cls = 'session-block'
      if (isRunning) cls += ' running'
      if (!isMine) cls += ' readonly'
      block.className = cls
      block.style.top = `${topMin * PX_PER_MIN}px`
      block.style.height = `${Math.max(heightMin * PX_PER_MIN, 14)}px`
      block.dataset.id = s.id
      const color = colorForUser(s.user_id)
      if (color) block.style.setProperty('--block-color', color)
      const who = isMine ? '' : `${userEmail(s.user_id)}\n`
      const fullStart = sessionDateFmt.format(new Date(s.started_at))
      const fullEnd = s.ended_at ? sessionDateFmt.format(new Date(s.ended_at)) : 'running'
      block.title = `${who}${fullStart} → ${fullEnd}`
      const totalMs = (s.ended_at ? new Date(s.ended_at) : new Date()) - new Date(s.started_at)
      block.innerHTML =
        `<div class="block-time">${timeFmt.format(new Date(s.started_at))}</div>` +
        `<div class="block-dur">${formatElapsed(totalMs)}</div>`
      dayColumns[dayIdx].appendChild(block)
    }
  }

  renderNowLine()

  if (!weekInitialScrollDone) {
    weekInitialScrollDone = true
    const targetHour = Math.max(0, Math.min(now.getHours() - 1, 18))
    weekScroll.scrollTop = targetHour * PX_PER_HOUR
  }
}

function renderNowLine() {
  const existing = weekBody.querySelector('.now-line')
  if (existing) existing.remove()
  const weekStart = weekStartDate()
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)
  const now = new Date()
  if (now < weekStart || now >= weekEnd) return
  const dayIdx = Math.floor((now - weekStart) / 86400000)
  const today = new Date(weekStart)
  today.setDate(weekStart.getDate() + dayIdx)
  today.setHours(0, 0, 0, 0)
  const topMin = (now - today) / 60000
  const dayCol = weekBody.querySelectorAll('.day-column')[dayIdx]
  const line = document.createElement('div')
  line.className = 'now-line'
  line.style.top = `${topMin * PX_PER_MIN}px`
  line.style.left = '0'
  line.style.right = '0'
  dayCol.appendChild(line)
}

weekPrevBtn.addEventListener('click', () => { weekOffset -= 1; renderWeek(); renderTeamPie() })
weekNextBtn.addEventListener('click', () => { weekOffset += 1; renderWeek(); renderTeamPie() })
weekTodayBtn.addEventListener('click', () => { weekOffset = 0; renderWeek(); renderTeamPie() })

weekBody.addEventListener('click', (e) => {
  const block = e.target.closest('.session-block')
  if (!block) return
  const id = block.dataset.id
  const s = teamSessions.find((x) => x.id === id)
  if (!s || s.user_id !== myUserId) return
  editingId = id
  renderSessions()
  const row = sessionsBody.querySelector(`button[data-id="${id}"]`)?.closest('tr')
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    row.classList.remove('flash')
    void row.offsetWidth // restart animation
    row.classList.add('flash')
  }
})

function colorForUser(userId) {
  if (!isAdmin) return null
  const idx = users.findIndex((u) => u.user_id === userId)
  const hue = USER_HUES[(idx < 0 ? 0 : idx) % USER_HUES.length]
  return `hsl(${hue}, 70%, 50%)`
}

function userEmail(userId) {
  return users.find((u) => u.user_id === userId)?.email ?? userId
}

async function loadAdminMeta() {
  isAdmin = false
  users = []
  try {
    const { data } = await supabase.rpc('is_admin')
    if (data === true) isAdmin = true
  } catch (_) { /* function may not exist yet */ }

  if (isAdmin) {
    const { data, error } = await supabase.rpc('list_users')
    if (!error && Array.isArray(data)) {
      users = data
      if (enabledUsers.size === 0) enabledUsers = new Set([myUserId])
    }
  } else {
    enabledUsers = new Set()
  }
  renderTeamToggles()
}

function renderTeamToggles() {
  if (!isAdmin || users.length === 0) {
    teamTogglesEl.hidden = true
    teamTogglesEl.innerHTML = ''
    return
  }
  teamTogglesEl.hidden = false
  teamTogglesEl.innerHTML = ''
  for (const u of users) {
    const isMe = u.user_id === myUserId
    const on = enabledUsers.has(u.user_id)
    const btn = document.createElement('button')
    btn.className = 'team-toggle' + (on ? ' on' : '')
    btn.style.setProperty('--user-color', colorForUser(u.user_id))
    btn.dataset.userId = u.user_id
    btn.innerHTML = `<span class="dot"></span>${isMe ? 'Me' : u.email}`
    teamTogglesEl.appendChild(btn)
  }
}

teamTogglesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.team-toggle')
  if (!btn) return
  const id = btn.dataset.userId
  if (enabledUsers.has(id)) enabledUsers.delete(id)
  else enabledUsers.add(id)
  renderTeamToggles()
  renderWeek()
})

function periodWindow(p) {
  const upper = Date.now() + 1000
  switch (p) {
    case 'today': return [startOfToday(), upper]
    case 'month': return [startOfMonth(), upper]
    case 'all':   return [0, upper]
    case 'week':
    default: {
      // Follow the currently navigated week in the week view.
      const ws = weekStartDate()
      const we = new Date(ws); we.setDate(ws.getDate() + 7)
      return [ws.getTime(), Math.min(we.getTime(), upper)]
    }
  }
}

function formatHours(ms) {
  if (ms < 60000) return '0m'
  const h = ms / 3600000
  if (h < 1) return `${Math.round(ms / 60000)}m`
  if (h < 10) return `${h.toFixed(1)}h`
  return `${Math.round(h)}h`
}

const SVG_NS = 'http://www.w3.org/2000/svg'
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

function renderTeamPie() {
  if (!isAdmin || users.length === 0) {
    teamStatsCard.hidden = true
    return
  }
  teamStatsCard.hidden = false

  const [winStart, winEnd] = periodWindow(teamPeriod)
  const totals = new Map()
  for (const s of teamSessions) {
    if (excludeSelf && s.user_id === myUserId) continue
    const ms = clippedMs(s, winStart, winEnd)
    if (ms <= 0) continue
    totals.set(s.user_id, (totals.get(s.user_id) ?? 0) + ms)
  }
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const totalMs = entries.reduce((acc, [, ms]) => acc + ms, 0)

  teamPie.innerHTML = ''
  if (totalMs === 0) {
    teamPie.appendChild(svgEl('circle', {
      cx: 50, cy: 50, r: 38, class: 'team-pie-empty'
    }))
  } else if (entries.length === 1) {
    const [userId] = entries[0]
    teamPie.appendChild(svgEl('circle', {
      cx: 50, cy: 50, r: 38,
      fill: colorForUser(userId) ?? 'var(--primary)',
      class: 'team-pie-slice'
    }))
  } else {
    const r = 38
    let cum = -Math.PI / 2
    for (const [userId, ms] of entries) {
      const frac = ms / totalMs
      const angle = frac * Math.PI * 2
      const x1 = 50 + r * Math.cos(cum)
      const y1 = 50 + r * Math.sin(cum)
      const x2 = 50 + r * Math.cos(cum + angle)
      const y2 = 50 + r * Math.sin(cum + angle)
      const large = angle > Math.PI ? 1 : 0
      const path = svgEl('path', {
        d: `M 50 50 L ${x1.toFixed(3)} ${y1.toFixed(3)} ` +
           `A ${r} ${r} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`,
        fill: colorForUser(userId) ?? 'var(--primary)',
        class: 'team-pie-slice'
      })
      const title = svgEl('title')
      title.textContent =
        `${userId === myUserId ? 'Me' : userEmail(userId)}\n` +
        `${formatHours(ms)} (${(frac * 100).toFixed(1)}%)`
      path.appendChild(title)
      teamPie.appendChild(path)
      cum += angle
    }
  }
  // Center label with total
  const total = svgEl('text', { x: 50, y: 51, class: 'pie-total' })
  total.textContent = totalMs === 0 ? '—' : formatHours(totalMs)
  teamPie.appendChild(total)
  const sub = svgEl('text', { x: 50, y: 58, class: 'pie-total-sub' })
  sub.textContent = 'total'
  teamPie.appendChild(sub)

  teamLegend.innerHTML = ''
  if (entries.length === 0) {
    const li = document.createElement('li')
    li.innerHTML = '<span class="empty">No sessions in this period</span>'
    teamLegend.appendChild(li)
    return
  }
  for (const [userId, ms] of entries) {
    const isMe = userId === myUserId
    const li = document.createElement('li')
    li.innerHTML =
      `<span class="swatch" style="background: ${colorForUser(userId)}"></span>` +
      `<span>${isMe ? 'Me' : userEmail(userId)}</span>` +
      `<span class="hours">${formatHours(ms)}</span>` +
      `<span class="pct">${(ms / totalMs * 100).toFixed(1)}%</span>`
    teamLegend.appendChild(li)
  }
}

periodTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-period]')
  if (!btn) return
  teamPeriod = btn.dataset.period
  periodTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn))
  renderTeamPie()
})

excludeMeToggle.addEventListener('click', () => {
  excludeSelf = !excludeSelf
  excludeMeToggle.classList.toggle('on', excludeSelf)
  renderTeamPie()
})

// --- Upcoming dates / countdown --------------------------------------------
// Admins add target dates; every signed-in user sees how long until each.

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
})

// 'YYYY-MM-DD' (a calendar date, no time) → local Date at midnight.
function parseDateOnly(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Whole calendar days from today (local) to the target date.
function daysUntil(targetDateStr) {
  const target = parseDateOnly(targetDateStr)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

function pluralWeeks(weeks) {
  const rounded = weeks % 1 === 0 ? weeks : Number(weeks.toFixed(1))
  return `${rounded} week${rounded === 1 ? '' : 's'}`
}

function countdownText(targetDateStr) {
  const days = daysUntil(targetDateStr)
  if (days === 0) return { text: 'Today', cls: 'today' }
  if (days < 0) {
    const ago = -days
    return { text: `${ago} day${ago === 1 ? '' : 's'} ago`, cls: 'past' }
  }
  const dayPart = `${days} day${days === 1 ? '' : 's'} left`
  const weekPart = days >= 7 ? ` · ${pluralWeeks(days / 7)}` : ''
  return { text: dayPart + weekPart, cls: days <= 7 ? 'soon' : 'future' }
}

async function loadMilestones() {
  const { data, error } = await supabase
    .from('milestones')
    .select('id, label, target_date')
    .order('target_date', { ascending: true })

  if (error) {
    // Table may not exist yet (migration not applied). Don't break the app.
    console.warn('Could not load milestones:', error.message)
    milestones = []
  } else {
    milestones = data ?? []
  }
  renderDates()
}

function dateDisplayRow(m) {
  const li = document.createElement('li')
  li.className = 'date-item'
  const cd = countdownText(m.target_date)
  li.innerHTML = `
    <div class="date-main">
      <span class="date-label"></span>
      <span class="date-when"></span>
    </div>
    <div class="date-right">
      <span class="countdown ${cd.cls}">${cd.text}</span>
      ${isAdmin ? `
        <span class="date-actions">
          <button class="small" data-date-action="edit" data-id="${m.id}">Edit</button>
          <button class="small danger" data-date-action="delete" data-id="${m.id}">Delete</button>
        </span>` : ''}
    </div>`
  // textContent (not innerHTML) so labels can't inject markup.
  li.querySelector('.date-label').textContent = m.label
  li.querySelector('.date-when').textContent = dateFmt.format(parseDateOnly(m.target_date))
  return li
}

function todayStr() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dateEditorRow(m) {
  const li = document.createElement('li')
  li.className = 'date-item editing'
  const isNew = !m
  li.innerHTML = `
    <div class="date-edit">
      <input type="text" class="date-label-input" placeholder="Label (e.g. Project deadline)">
      <input type="date" class="date-date-input">
    </div>
    <div class="date-right">
      <button class="small primary" data-date-action="${isNew ? 'save-new' : 'save'}"${isNew ? '' : ` data-id="${m.id}"`}>Save</button>
      <button class="small" data-date-action="${isNew ? 'cancel-new' : 'cancel'}">Cancel</button>
    </div>`
  // Set values via properties to avoid HTML-escaping the label.
  li.querySelector('.date-label-input').value = m ? m.label : ''
  li.querySelector('.date-date-input').value = m ? m.target_date : todayStr()
  return li
}

function renderDates() {
  if (!datesList) return
  addDateBtn.hidden = !isAdmin
  datesList.innerHTML = ''

  if (addingDate) datesList.appendChild(dateEditorRow(null))

  if (milestones.length === 0 && !addingDate) {
    const li = document.createElement('li')
    li.className = 'date-empty'
    li.textContent = isAdmin
      ? 'No dates yet — click “Add date” to create one.'
      : 'No upcoming dates.'
    datesList.appendChild(li)
    return
  }

  for (const m of milestones) {
    datesList.appendChild(editingDateId === m.id ? dateEditorRow(m) : dateDisplayRow(m))
  }
}

addDateBtn.addEventListener('click', () => {
  addingDate = true
  editingDateId = null
  renderDates()
})

datesList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-date-action]')
  if (!btn) return
  const action = btn.dataset.dateAction
  const id = btn.dataset.id

  if (action === 'edit') { editingDateId = id; addingDate = false; renderDates(); return }
  if (action === 'cancel') { editingDateId = null; renderDates(); return }
  if (action === 'cancel-new') { addingDate = false; renderDates(); return }

  if (action === 'save' || action === 'save-new') {
    const li = btn.closest('li')
    const label = li.querySelector('.date-label-input').value.trim()
    const dateStr = li.querySelector('.date-date-input').value
    if (!label) { showError('Enter a label for the date.'); return }
    if (!dateStr) { showError('Pick a target date.'); return }
    showError('')
    if (action === 'save-new') {
      const { error } = await supabase.from('milestones').insert({ label, target_date: dateStr })
      if (error) { showError(error.message); return }
      addingDate = false
    } else {
      const { error } = await supabase.from('milestones').update({ label, target_date: dateStr }).eq('id', id)
      if (error) { showError(error.message); return }
      editingDateId = null
    }
    await loadMilestones()
    return
  }

  if (action === 'delete') {
    if (!confirm('Delete this date?')) return
    showError('')
    const { error } = await supabase.from('milestones').delete().eq('id', id)
    if (error) { showError(error.message); return }
    if (editingDateId === id) editingDateId = null
    await loadMilestones()
    return
  }
})

async function render() {
  showError('')
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    signedOut.hidden = false
    signedIn.hidden  = true
    return
  }

  signedOut.hidden = true
  signedIn.hidden  = false
  userLabel.textContent = session.user.email ?? session.user.id
  myUserId = session.user.id
  await loadAdminMeta()
  await loadSessions()
  await loadMilestones()
}

signInBtn.addEventListener('click', async () => {
  showError('')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  })
  if (error) showError(error.message)
})

signOutBtn.addEventListener('click', async () => {
  showError('')
  const { error } = await supabase.auth.signOut()
  if (error) showError(error.message)
})

startBtn.addEventListener('click', async () => {
  showError('')
  setBusy(true)
  const { error } = await supabase.from('sessions').insert({})
  if (error && error.code !== '23505') {
    // 23505 = unique violation on one_open_session_per_user → a session
    // is already open (e.g. opened in another tab). Treat as success and
    // just re-read state.
    showError(error.message)
  }
  await loadSessions()
})

stopBtn.addEventListener('click', async () => {
  showError('')
  setBusy(true)
  // Scoped to ended_at is null so a duplicate Stop is a 0-row no-op.
  const { error } = await supabase
    .from('sessions')
    .update({ ended_at: new Date().toISOString() })
    .is('ended_at', null)
  if (error) showError(error.message)
  await loadSessions()
})

supabase.auth.onAuthStateChange((_event, _session) => {
  render()
})

render()
