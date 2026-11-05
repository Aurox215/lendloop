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
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
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
  await call('Runtime.enable')
  let loaded = false
  for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
    await call('Page.navigate', { url: process.env.APP_URL ?? 'http://localhost:3000' })
    const started = Date.now()
    while (Date.now() - started < 45_000) {
      if (await evaluate('!!document.querySelector("article h2 a")')) { loaded = true; break }
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
  const detailPath = await evaluate('document.querySelector("article h2 a").getAttribute("href")')
  const detailName = await evaluate('document.querySelector("article h2 a").textContent')
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
  async function waitFor(expression, message) {
    const started = Date.now()
    while (!await evaluate(expression)) {
      assert.ok(Date.now() - started < 5000, message)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
    }
  }
  await evaluate(`(() => {
    const card = document.querySelector('article');
    card.querySelector('h2 a').textContent = 'Title'.repeat(100);
    const paragraphs = card.querySelectorAll('p');
    paragraphs[0].textContent = 'Category'.repeat(100);
    paragraphs[1].textContent = 'Description'.repeat(200);
    return true;
  })()`)

  for (const width of [320, 375, 768, 1440]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 })
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await evaluate('document.getElementById("layout-open-modal").focus(); document.getElementById("layout-open-modal").click()')
    await waitFor('!!document.querySelector("dialog[open]")', 'Shared modal did not open.')
    const centered = await evaluate(`(() => {
      const box = document.querySelector('dialog[open]').getBoundingClientRect();
      return { x: Math.abs(box.left + box.width / 2 - document.documentElement.clientWidth / 2), y: Math.abs(box.top + box.height / 2 - document.documentElement.clientHeight / 2) };
    })()`)
    assert.ok(centered.x <= 1 && centered.y <= 1, `Modal not centered at ${width}px: ${JSON.stringify(centered)}`)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1 })
    await waitFor('!document.querySelector("dialog[open]")', 'Outside click did not close the modal.')
    const metrics = await evaluate(`(() => {
      const card = document.querySelector('article');
      const title = card.querySelector('h2 a');
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
  await call('Page.navigate', { url: new URL(detailPath, process.env.APP_URL ?? 'http://localhost:3000').href })
  const detailStarted = Date.now()
  while (!await evaluate(`document.querySelector('main h1')?.textContent === ${JSON.stringify(detailName)}`)) {
    assert.ok(Date.now() - detailStarted < 45_000, 'Detail page did not load.')
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  const detailVisible = await evaluate(`(() => {
    const main = document.querySelector('main');
    const title = main.querySelector('h1');
    return title && getComputedStyle(title).webkitLineClamp === 'none';
  })()`)
  assert.equal(detailVisible, true, 'Detail titles must not be clamped.')
  console.log('Detail route verified: complete title rendering without clamping.')
  await evaluate(`window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('Synthetic layout-check failure') }))`)
  const toastStarted = Date.now()
  while (!await evaluate(`!![...document.querySelectorAll('[data-sonner-toast]')].find(node => node.textContent.includes('An operation failed.'))`)) {
    assert.ok(Date.now() - toastStarted < 5000, 'Error notification did not appear.')
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  assert.equal(await evaluate(`document.querySelector('main h1')?.textContent === ${JSON.stringify(detailName)}`), true)
  const toastClose = await evaluate(`(() => {
    const toast = [...document.querySelectorAll('[data-sonner-toast]')].find(node => node.textContent.includes('An operation failed.'));
    const close = toast.querySelector('[data-close-button]').getBoundingClientRect();
    const box = toast.getBoundingClientRect();
    return close.left > box.left + box.width / 2 && Math.abs(close.top - box.top) <= 16;
  })()`)
  assert.equal(toastClose, true, 'Notification close button must be in its top-right corner.')
  console.log('Failure recovery verified: an unhandled frontend failure shows a Sonner notification and keeps the page visible.')
} finally {
  socket?.close()
  browser.kill()
  await once(browser, 'exit').catch(() => {})
  const resolvedProfile = resolve(profile)
  if (resolvedProfile.startsWith(`${resolve(tmpdir())}${sep}`) && basename(resolvedProfile).startsWith('lendloop-layout-')) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
