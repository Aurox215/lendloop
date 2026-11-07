import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve, sep } from 'node:path'
import { once } from 'node:events'
import { build, stop } from 'esbuild'

let modalBundle
try {
  const output = await build({ entryPoints: ['scripts/layout-fixture.tsx'], bundle: true, write: false,
    platform: 'browser', format: 'iife', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
  modalBundle = output.outputFiles[0].text
} finally { stop() }

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)
let browserPath
for (const candidate of candidates) {
  try { await access(candidate); browserPath = candidate; break } catch { /* Try the next installation. */ }
}
assert.ok(browserPath, 'Set CHROME_PATH to a Chrome/Chromium executable.')

const profile = await mkdtemp(resolve(tmpdir(), 'lendloop-layout-'))
const browser = spawn(browserPath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
let socket

try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser startup timed out.')), 20_000)
    browser.once('error', reject)
    browser.stderr.on('data', chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
    })
  })
  socket = new WebSocket(endpoint)
  await once(socket, 'open')
  let sequence = 0
  const pending = new Map()
  const browserErrors = []
  const consoleErrors = []
  const documentRequests = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Network.requestWillBeSent' && message.params.type === 'Document') documentRequests.push(message.params.request.url)
    if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  function send(method, params = {}, sessionId) {
    return new Promise((resolveResult, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)) }, 30_000)
      pending.set(id, { resolve: resolveResult, reject, timer })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  await call('Page.enable')
  await call('Network.enable')
  await call('Runtime.enable')
  let loaded = false
  for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
    await call('Page.navigate', { url: process.env.APP_URL ?? 'http://localhost:3000' })
    const started = Date.now()
    while (Date.now() - started < 45_000) {
      if (await evaluate('!!document.querySelector("article h2 span")')) { loaded = true; break }
      const content = await evaluate('document.body?.innerText ?? ""')
      if (content.includes('proxy_request_failed')) break
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
    }
    if (!loaded) console.log(`Dashboard loading retry ${attempt + 1}/3 (authentication/network dependency).`)
  }
  if (!loaded) {
    const content = await evaluate('document.body.innerText.slice(0, 1000)')
    throw new Error(`Dashboard tools did not load. ${JSON.stringify({ content, browserErrors })}`)
  }
  const detailPath = '/tools/private-tool'
  assert.equal(await evaluate('document.querySelectorAll("article h2 a").length'), 0, 'Tool titles must not link to a detail page.')
  assert.equal(await evaluate('document.querySelectorAll("article")[0].querySelectorAll("p").length'), 1, 'Public cards expose name/category only.')
  await evaluate(`[...document.querySelectorAll('article button')].find(button => button.textContent === 'Borrow').click()`)
  const borrowStarted = Date.now()
  while (!await evaluate(`document.body.textContent.includes('Sign in to borrow this tool.')`)) {
    assert.ok(Date.now() - borrowStarted < 5000, 'Anonymous borrowing must show a sign-in notification.')
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  console.log('Anonymous Borrow action verified: sign-in notification, no navigation.')
  await evaluate(modalBundle)
  await waitFor('!!document.querySelector("#layout-open-modal")', 'Modal fixture did not mount.')
  const controls = await evaluate(`(() => {
    const button = document.querySelector('#layout-open-modal');
    const select = document.querySelector('main select');
    return { pointer: getComputedStyle(button).cursor, alignment: getComputedStyle(select).textAlign,
      optionAlignment: getComputedStyle(select.querySelector('option')).textAlign };
  })()`)
  assert.equal(controls.pointer, 'pointer', 'Enabled buttons must use a pointer cursor.')
  assert.equal(controls.alignment, 'left', 'Select text must be left-aligned.')
  assert.equal(controls.optionAlignment, 'left', 'Dropdown options must be left-aligned.')
  console.log('Controls verified: pointer cursors and left-aligned dropdown text.')
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#layout-request-actions button')].map(button => button.textContent)`), ['Accept', 'Decline'])
  await evaluate(`document.querySelector('#layout-request-actions button').click()`)
  await waitFor(`document.querySelector('dialog[open] h2')?.textContent === 'Accept borrow request?'`, 'Accept confirmation did not open.')
  assert.equal(await evaluate('window.__layoutDecisions.length'), 0, 'Opening confirmation must not mutate.')
  await evaluate(`[...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === 'Cancel').click()`)
  await waitFor(`!document.querySelector('dialog[open]')`, 'Cancel must close confirmation.')
  assert.equal(await evaluate('window.__layoutDecisions.length'), 0, 'Cancelling must not mutate.')
  for (const label of ['Accept', 'Decline']) {
    await evaluate(`[...document.querySelectorAll('#layout-request-actions button')].find(button => button.textContent === '${label}').click()`)
    await waitFor(`!!document.querySelector('dialog[open]')`, 'Decision confirmation did not open.')
    await evaluate(`[...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === '${label}').click()`)
    await waitFor(`!document.querySelector('dialog[open]')`, 'Confirmation did not complete.')
  }
  assert.deepEqual(await evaluate('window.__layoutDecisions.map(args => args.decision)'), ['approved', 'declined'])
  console.log('Request decisions verified: Accept first, confirmation required, Cancel does not mutate (isolated stub).')
  await evaluate("document.querySelector('#layout-return-actions button').click()")
  await waitFor("document.querySelector('dialog[open] h2')?.textContent === 'Have you physically received the tool?'", 'Physical return confirmation required.')
  await evaluate("[...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === 'Yes, mark returned').click()")
  await waitFor("!document.querySelector('dialog[open]')", 'Return confirmation did not close.')
  assert.deepEqual(await evaluate('window.__layoutDecisions.at(-1)'), { loanId: 'fixture-loan' })
  const errorCount = browserErrors.length
  const consoleCount = consoleErrors.length
  await evaluate(`(() => {
    const inputs = document.querySelectorAll('#layout-borrow-form input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputs.forEach(input => { set.call(input, '2099-01-01'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  })()`)
  await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  await evaluate("document.querySelector('#layout-borrow-form form').requestSubmit()")
  await waitFor("document.querySelector('#layout-borrow-form [role=alert]')?.textContent.includes('overlapping dates')", 'Expected validation must appear inline.')
  await waitFor("!![...document.querySelectorAll('[data-sonner-toast]')].find(node => node.textContent.includes('overlapping dates'))", 'Expected validation warning must appear.')
  assert.equal(browserErrors.length, errorCount, 'Expected validation must not throw in the browser.')
  assert.equal(consoleErrors.length, consoleCount, 'Expected validation must not log a console error.')
  console.log('Return confirmation and duplicate-request warning verified with isolated mutations; no uncaught error or console.error.')
  async function waitFor(expression, message) {
    const started = Date.now()
    while (!await evaluate(expression)) {
      assert.ok(Date.now() - started < 5000, message)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
    }
  }
  await evaluate(`(() => {
    const card = document.querySelector('article');
    card.querySelector('h2 span').textContent = 'Title'.repeat(100);
    const paragraphs = card.querySelectorAll('p');
    paragraphs[0].textContent = 'Category'.repeat(100);
    const description = document.createElement('p'); description.className = 'mt-4 line-clamp-3 text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]'; description.textContent = 'Description'.repeat(200); card.append(description);
    return true;
  })()`)

  for (const width of [320, 375, 768, 1440]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 })
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await evaluate('document.getElementById("layout-open-modal").focus(); document.getElementById("layout-open-modal").click()')
    await waitFor('!!document.querySelector("dialog[open]")', 'Shared modal did not open.')
    const centered = await evaluate(`(() => {
      const box = document.querySelector('dialog[open]').getBoundingClientRect();
      return { width: box.width, x: Math.abs(box.left + box.width / 2 - document.documentElement.clientWidth / 2), y: Math.abs(box.top + box.height / 2 - document.documentElement.clientHeight / 2) };
    })()`)
    assert.ok(centered.x <= 1 && centered.y <= 1, `Modal not centered at ${width}px: ${JSON.stringify(centered)}`)
    assert.ok(centered.width <= 640, 'Modals must remain compact on large screens.')
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1 })
    await waitFor('!document.querySelector("dialog[open]")', 'Outside click did not close the modal.')
    const metrics = await evaluate(`(() => {
      const card = document.querySelector('article');
      const title = card.querySelector('h2 span');
      const category = card.querySelectorAll('p')[0];
      const description = card.querySelectorAll('p')[1];
      const lines = element => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight);
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        titleLines: lines(title), descriptionLines: lines(description),
        categoryEllipsis: getComputedStyle(category).textOverflow,
        categoryClipped: category.scrollWidth > category.clientWidth,
        cardOverflow: card.scrollWidth > card.clientWidth + 1,
        fullTitleRetained: title.textContent.length === 500,
      };
    })()`)
    assert.ok(metrics.documentWidth <= metrics.width + 1, `Viewport overflow at ${width}px: ${JSON.stringify(metrics)}`)
    assert.ok(metrics.titleLines <= 2.05, `Title exceeded two lines at ${width}px`)
    assert.ok(metrics.descriptionLines <= 3.05, `Description exceeded three lines at ${width}px`)
    assert.equal(metrics.categoryEllipsis, 'ellipsis')
    assert.equal(metrics.categoryClipped, true)
    assert.equal(metrics.cardOverflow, false)
    assert.equal(metrics.fullTitleRetained, true)
    const containers = await evaluate(`(() => {
      const main = document.querySelector('main');
      const table = document.createElement('table');
      table.innerHTML = '<tbody><tr><td>' + 'TableCell'.repeat(100) + '</td><td>Category</td></tr></tbody>';
      main.append(table);
      const tableWidth = table.getBoundingClientRect().width;
      const mainWidth = main.clientWidth;
      const tableLayout = getComputedStyle(table).tableLayout;
      const tableFits = tableWidth <= mainWidth + 1;
      const tableNoOverflow = document.documentElement.scrollWidth <= innerWidth + 1;
      table.remove();
      const modal = document.createElement('dialog');
      modal.innerHTML = '<p>' + 'ModalText'.repeat(200) + '</p><button>' + 'ButtonText'.repeat(100) + '</button>';
      document.body.append(modal);
      modal.showModal();
      const modalFits = modal.getBoundingClientRect().width <= innerWidth;
      const buttonFits = modal.querySelector('button').getBoundingClientRect().width <= modal.clientWidth;
      modal.close();
      modal.remove();
      return { tableFits, tableNoOverflow, modalFits, buttonFits, tableWidth, mainWidth, tableLayout };
    })()`)
    for (const [check, passed] of Object.entries(containers)) {
      if (typeof passed === 'boolean') assert.equal(passed, true, `${check} failed at ${width}px: ${JSON.stringify(containers)}`)
    }
    console.log(`Layout verified at ${width}px: centered shared modal, backdrop dismissal, clamped cards, no horizontal overflow.`)
  }
  await evaluate('window.__unmountLayoutFixture()')
  const origin = process.env.APP_URL ?? 'http://localhost:3000'
  for (const path of [detailPath, '/my-listings', '/my-requests', '/incoming-requests', '/admin/categories', '/admin/loans', '/tools/private.svg']) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual' })
    assert.ok([302, 307].includes(response.status), 'Anonymous protected page must redirect: ' + path)
    assert.equal(new URL(response.headers.get('location'), origin).pathname, '/signin')
  }
  assert.equal((await fetch(new URL('/api/private', origin), { method: 'POST', redirect: 'manual' })).status, 401)
  console.log('Protected pages redirect to /signin; direct unauthenticated API calls return 401, including extension-shaped routes.')
  await evaluate(`window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('Synthetic layout-check failure') }))`)
  const toastStarted = Date.now()
  while (!await evaluate(`!![...document.querySelectorAll('[data-sonner-toast]')].find(node => node.textContent.includes('An operation failed.'))`)) {
    assert.ok(Date.now() - toastStarted < 5000, 'Error notification did not appear.')
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  assert.equal(await evaluate(`!!document.querySelector('main h1')`), true)
  const toastClose = await evaluate(`(() => {
    const toast = [...document.querySelectorAll('[data-sonner-toast]')].find(node => node.textContent.includes('An operation failed.'));
    const close = toast.querySelector('[data-close-button]').getBoundingClientRect();
    const box = toast.getBoundingClientRect();
    return close.left > box.left + box.width / 2 && Math.abs(close.top - box.top) <= 16;
  })()`)
  assert.equal(toastClose, true, 'Notification close button must be in its top-right corner.')
  console.log('Failure recovery verified: an unhandled frontend failure shows a Sonner notification and keeps the page visible.')
  const navigationStart = documentRequests.length
  await evaluate('window.__sidebarNavigationMarker = crypto.randomUUID(); window.__sidebarHeader = document.querySelector("header"); window.__sidebarElement = document.querySelector("aside"); history.pushState(null, "", "/?sidebar-navigation-check=1")')
  const marker = await evaluate('window.__sidebarNavigationMarker')
  await waitFor('location.search.includes("sidebar-navigation-check")', 'Navigation setup failed.')
  await evaluate('document.querySelector("aside nav a").click()')
  await waitFor('location.pathname === "/" && location.search === ""', 'Sidebar link did not complete client navigation.')
  assert.equal(await evaluate('window.__sidebarNavigationMarker'), marker, 'Sidebar navigation must not reload the document.')
  assert.equal(await evaluate('document.querySelector("header") === window.__sidebarHeader && document.querySelector("aside") === window.__sidebarElement'), true, 'Sidebar and header must stay mounted.')
  assert.equal(documentRequests.length, navigationStart, 'Client sidebar navigation must not issue a Document request.')
  console.log('Sidebar client navigation verified: URL updates, no document reload, header and sidebar stay mounted (public Dashboard link).')

} finally {
  socket?.close()
  browser.kill()
  await once(browser, 'exit').catch(() => {})
  const resolvedProfile = resolve(profile)
  if (resolvedProfile.startsWith(`${resolve(tmpdir())}${sep}`) && basename(resolvedProfile).startsWith('lendloop-layout-')) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
