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

const PX_PER_HOUR = 40
const PX_PER_MIN = PX_PER_HOUR / 60
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

let openSession = null
let allSessions = []
let warningTimer = null
let editingId = null
let addingNew = false
let weekOffset = 0
let weekInitialScrollDone = false

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
    .select('id, started_at, ended_at')
    .order('started_at', { ascending: false })

  if (error) {
    showError(error.message)
    return
  }

  allSessions = data
  openSession = data.find((s) => s.ended_at === null) ?? null
  renderTotals()
  renderRunningState()
  renderSessions()
  renderWeek()
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
  return allSessions.reduce(
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

function toLocalInput(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
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
    const now = toLocalInput(new Date().toISOString())
    tr.innerHTML = `
      <td><input type="datetime-local" step="1" id="new-start" value="${now}"></td>
      <td><input type="datetime-local" step="1" id="new-end"   value="${now}"></td>
      <td>—</td>
      <td class="actions">
        <button class="small primary" data-action="save-new">Save</button>
        <button class="small" data-action="cancel-new">Cancel</button>
      </td>`
    sessionsBody.appendChild(tr)
  }

  for (const s of allSessions) {
    const tr = document.createElement('tr')
    const isRunning = s.ended_at === null
    if (editingId === s.id) {
      const startVal = toLocalInput(s.started_at)
      const endVal = isRunning ? '' : toLocalInput(s.ended_at)
      tr.innerHTML = `
        <td><input type="datetime-local" step="1" data-field="start" value="${startVal}"></td>
        <td>${
          isRunning
            ? '<em title="Use the Stop button to close this session">(running)</em>'
            : `<input type="datetime-local" step="1" data-field="end" value="${endVal}">`
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
    const startIso = fromLocalInput(row.querySelector('[data-field="start"]').value)
    const endInput = row.querySelector('[data-field="end"]')
    const endIso = endInput ? fromLocalInput(endInput.value) : null
    if (!startIso) { showError('Start time is required.'); return }
    if (endInput && !endIso) { showError('End time is required.'); return }
    if (endIso && new Date(endIso) < new Date(startIso)) {
      showError('End must be on or after start.'); return
    }
    showError('')
    const patch = endInput
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
    const startIso = fromLocalInput($('new-start').value)
    const endIso   = fromLocalInput($('new-end').value)
    if (!startIso || !endIso) { showError('Both start and end are required.'); return }
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

  for (const s of allSessions) {
    const isRunning = s.ended_at === null
    const segments = splitSessionByDay(s, weekStart, weekEnd)
    for (const seg of segments) {
      const segDay = new Date(seg.start)
      segDay.setHours(0, 0, 0, 0)
      const dayIdx = Math.round((segDay - weekStart) / 86400000)
      if (dayIdx < 0 || dayIdx > 6) continue
      const topMin = (seg.start - segDay) / 60000
      const heightMin = Math.max((seg.end - seg.start) / 60000, 0.5)
      const block = document.createElement('div')
      block.className = 'session-block' + (isRunning ? ' running' : '')
      block.style.top = `${topMin * PX_PER_MIN}px`
      block.style.height = `${Math.max(heightMin * PX_PER_MIN, 14)}px`
      block.dataset.id = s.id
      const fullStart = sessionDateFmt.format(new Date(s.started_at))
      const fullEnd = s.ended_at ? sessionDateFmt.format(new Date(s.ended_at)) : 'running'
      block.title = `${fullStart} → ${fullEnd}`
      const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
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

weekPrevBtn.addEventListener('click', () => { weekOffset -= 1; renderWeek() })
weekNextBtn.addEventListener('click', () => { weekOffset += 1; renderWeek() })
weekTodayBtn.addEventListener('click', () => { weekOffset = 0; renderWeek() })

weekBody.addEventListener('click', (e) => {
  const block = e.target.closest('.session-block')
  if (!block) return
  const id = block.dataset.id
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
  await loadSessions()
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
