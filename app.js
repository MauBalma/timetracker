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

let openSession = null
let warningTimer = null

function showError(msg) {
  errorEl.textContent = msg ?? ''
}

function setBusy(busy) {
  startBtn.disabled = busy || !!openSession
  stopBtn.disabled  = busy || !openSession
}

async function refreshOpenSession() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, started_at')
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)

  if (error) {
    showError(error.message)
    return
  }

  openSession = data[0] ?? null
  renderRunningState()
}

function renderRunningState() {
  clearInterval(warningTimer)
  warningEl.style.display = 'none'

  if (openSession) {
    const started = new Date(openSession.started_at)
    statusEl.textContent = `Running since ${started.toLocaleString()}`
    startBtn.disabled = true
    stopBtn.disabled  = false

    const tick = () => {
      const hours = (Date.now() - started.getTime()) / 3600000
      if (hours >= FORGOT_TO_STOP_HOURS) {
        warningEl.textContent =
          `Running for ${hours.toFixed(1)}h — did you forget to stop?`
        warningEl.style.display = 'block'
      }
    }
    tick()
    warningTimer = setInterval(tick, 60_000)
  } else {
    statusEl.textContent = 'Not running'
    startBtn.disabled = false
    stopBtn.disabled  = true
  }
}

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
  await refreshOpenSession()
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
  await refreshOpenSession()
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
  await refreshOpenSession()
})

supabase.auth.onAuthStateChange((_event, _session) => {
  render()
})

render()
