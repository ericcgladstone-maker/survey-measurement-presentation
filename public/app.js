// Plays one recorded Claude Code session, section by section and beat by beat.
// Every reply, tool call and result shown comes from the session's own output (data/session.js,
// built by capture-runner/build-data.py). Pacing, the spotlight and the walkthrough prose
// (data/walkthrough.js) are editorial; the real time each reply took is shown beneath the console.
(() => {
  const S = window.SESSION
  const NOTES = window.WALKTHROUGH || {}
  const $ = (id) => document.getElementById(id)
  const term = $('term'), log = $('log'), typed = $('typed'), spinner = $('spinner'), latest = $('latest')
  const speeds = [1, 2, 4]
  let speedIdx = 0, playing = true, run = 0, follow = true
  let cur = { scene: 0, beat: -1 } // beat -1 is the question step
  const pace = () => speeds[speedIdx]
  const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const md = (s) => window.marked.parse(s, { gfm: true, breaks: true })
  const qfp = (h, toks) => !toks.length ? h : h.replace(new RegExp('(^|[^\\d.−-])(' + toks.slice().sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\d])', 'g'), '$1<span class="qf">$2</span>')
  const bold = (h) => h.replace(/\*\*(.+?)\*\*/g, (m, t) => /^[~≈+±−-]?\d[\d.,]*(?:\s?[–-]\s?\d[\d.,]*)?\s?%?$/.test(t) ? `<span class="qf">${t}</span>` : `<strong>${t}</strong>`)
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }
  const numbered = (x) => !!x.prompt && !x.opening // an opening that shows real session parts is not a numbered section
  const nQ = S.scenes.filter(numbered).length
  const qNum = (i) => S.scenes.slice(0, i + 1).filter(numbered).length
  const beatsOf = (i) => S.scenes[i].beats || []
  const noteRaw = (i, k) => { const n = NOTES[S.scenes[i].id]; return !n ? '' : Array.isArray(n) ? n[k] || '' : n[String(k + 1)] || '' }
  const noteOf = (i, k) => { const n = noteRaw(i, k); return typeof n === 'string' ? n : n.text || '' }
  const focusOf = (i, k) => { const n = noteRaw(i, k); return typeof n === 'string' ? [] : n.focus || [] }
  const isAlias = (i, k) => k >= 0 && !!(beatsOf(i)[k] || {}).alias
  const realOf = (i, k) => { while (k > 0 && isAlias(i, k)) k--; return k }
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
  const fmt = (x) => { const s = Math.round(x); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s` }
  // Long tool runs are shortened in playback: the first 4 and last 3 calls stay (and, in a part marked keepFailed, any call that failed)
  const toolPlan = (beat) => {
    const tl = beat.blocks.filter((b) => b.kind === 'tool'), n = tl.length
    const hide = tl.map((b, x) => n > 10 && x >= 4 && x < n - 3 && !(beat.keepFailed && (String(b.error) === 'true' || b.error === true)) && !(beat.keepTools || []).includes(x))
    const run = hide.map((h, x) => (h && (x === 0 || !hide[x - 1]) ? hide.slice(x).findIndex((v) => !v) : 0))
    return { hide, run: run.map((r, x) => (r === -1 ? hide.length - x : r)) }
  }
  const SHORT = (n) => `… ${n} more tool call${n === 1 ? '' : 's'} (searches, file reads, code runs), shortened for time · pause to see every call`

  const PHASES = window.PHASES
  const idxOf = (id) => S.scenes.findIndex((x) => x.id === id)
  const rail = $('rail')
  PHASES.forEach(([name, a, b]) => {
    const n = idxOf(b) - idxOf(a) + 1
    const btn = el('button', 'phase', `<span class="pname">${name}</span>`)
    btn.type = 'button'; btn.title = `${name}: sections ${qNum(idxOf(a))}–${qNum(idxOf(b))}`
    btn.addEventListener('click', () => go(idxOf(a), -1))
    rail.append(btn)
  })
  function setRail(i) {
    const q = numbered(S.scenes[i]) ? qNum(i) : 0
    ;[...rail.children].forEach((btn, p) => {
      const a = qNum(idxOf(PHASES[p][1])), b = qNum(idxOf(PHASES[p][2]))
      btn.classList.toggle('on', q >= a && q <= b); btn.classList.toggle('done', q > b)
    })
  }
  let qn = 0
  S.scenes.forEach((s, i) => $('jump').append(new Option(`${numbered(s) ? String(++qn).padStart(2, '0') + ' · ' : ''}${s.title}`, i)))

  // ---------- scrolling: follow the lit beat unless the reader has scrolled away
  let programmatic = false
  const setScroll = (y) => { programmatic = true; term.scrollTop = Math.max(0, y); requestAnimationFrame(() => { programmatic = false }) }
  const followEnd = (node) => { if (follow && node) setScroll(node.offsetTop + node.offsetHeight - term.clientHeight + 28) }
  const inspect = (on) => document.body.classList.toggle('inspect', on)
  // Scrolling keeps the focus: the current part stays lit and the rest stays dimmed. Pointing at a dimmed part brightens it (CSS); clicking one makes it the current part.
  term.addEventListener('scroll', () => {
    if (programmatic || !playing) return
    follow = term.scrollHeight - term.scrollTop - term.clientHeight < 40
    latest.hidden = follow
  })
  latest.addEventListener('click', () => { follow = true; latest.hidden = true; followEnd(log.querySelector('.beat.lit')) })

  // ---------- timing that respects pause, speed and navigation
  const sleep = (ms, my) => new Promise((res, rej) => {
    let left = ms
    const step = () => {
      if (my !== run) return rej(new Error('stale'))
      if (!playing) return setTimeout(step, 100)
      const d = Math.min(50, left); left -= d * pace()
      if (left <= 0) return res()
      setTimeout(step, d)
    }
    step()
  })

  // ---------- console pieces
  function toolLines(b) {
    const f = document.createDocumentFragment()
    f.append(el('div', 'tool' + (b.error ? ' err' : ''), `<span class="name">${esc(b.name)}</span>${b.arg ? `<span class="arg">(${esc(b.arg)})</span>` : ''}`))
    if (b.result) f.append(el('div', 'result', `<span class="elbow">⎿  </span><span class="rbody">${esc(b.result)}</span>`))
    return f
  }
  function beatShell(i, k) {
    const node = el('div', 'beat')
    node.dataset.k = String(k)
    node.addEventListener('click', () => { if (!playing) { inspect(false); cur.beat = k; spotlight(k); setPhase(i, k) } })
    return node
  }
  function fillBeat(node, beat, collapse) {
    const tools = beat.blocks.filter((b) => b.kind === 'tool').length
    const plan = toolPlan(beat)
    let t = 0
    for (const b of beat.blocks) {
      if (b.kind === 'text') { node.append(el('div', 'amsg' + (b.cont ? ' cont' : ''), md(b.md))); continue }
      if (b.kind === 'elide') { node.append(el('div', 'elide', esc(b.text))); continue }
      if (b.kind === 'prompt') { node.append(el('div', 'umsg2', esc(b.text))); continue }
      if (b.kind === 'figure') { node.append(figure(b)); continue }
      if (b.kind === 'agent') { node.append(agentRep(b)); continue }
      if (b.kind === 'bg') { node.append(bgDone(b)); continue }
      t++
      if (collapse && plan.hide[t - 1]) { if (plan.run[t - 1]) node.append(el('div', 'note', SHORT(plan.run[t - 1]))); continue }
      node.append(toolLines(b))
    }
  }
  // A research sub-agent's report as it returned to Claude (verbatim), and a background command finishing
  const agentRep = (b) => el('div', 'agentrep', `<div class="agenthead"><span class="name">Sub-agent report</span><span class="arg"> · ${esc(b.name)}</span></div><div class="agentbody">${md(b.md)}</div>`)
  const bgDone = (b) => el('div', 'bgdone', `<span class="elbow">✓ </span>Background task finished · ${esc(b.text)}`)
  // The prompt as typed; a researcher checkpoint (sentences written live after reading the previous reply) is marked as such
  const umsgOf = (sc) => {
    if (!sc.checkpoint || !sc.prompt.startsWith(sc.checkpoint)) return el('div', 'umsg', esc(sc.prompt))
    return el('div', 'umsg', `<div class="ckp"><span class="ckl">Researcher decision · written live after reading the previous reply</span>${esc(sc.checkpoint)}</div>${esc(sc.prompt.slice(sc.checkpoint.length).replace(/^\n+/, ''))}`)
  }
  // A figure the session saved, displayed from the file it wrote (the page draws nothing itself)
  const figure = (b) => el('figure', 'sfig', `<img src="${b.src}" alt="${esc(b.path)}" width="${b.w}" height="${b.h}"><figcaption>${esc(b.path)} · the saved file, displayed here</figcaption>`)
  // The post-session turns are labelled once, above the first of them
  const postLabel = (sc) => { if (sc.post_label) log.append(el('div', 'postlabel', esc(sc.post_label))) }
  function spotlight(k) {
    const i = cur.scene, r = k >= 0 ? realOf(i, k) : k
    const nodes = [...log.querySelectorAll('.beat')], at = nodes.findIndex((n) => Number(n.dataset.k) === r)
    nodes.forEach((n, x) => { n.classList.toggle('lit', x === at); n.classList.toggle('prev', at > 0 && x === at - 1); n.classList.toggle('past', at < 0 ? true : (x < at - 1 || x > at)) })
    emphasize(i, k)
    const u = log.querySelector('.umsg')
    if (u) { u.classList.toggle('past', k >= 0); u.classList.toggle('lit', k === -1) }
  }
  // Focal numbers: wrapped at display time in highlight spans; the recorded text itself is unchanged
  // A note can name a position inside its part (a line of the recorded text); the console scrolls there
  const anchorY = (i, k) => {
    const n = noteRaw(i, k); if (!n || !n.anchor) return null
    const lit = log.querySelector('.beat.lit'); if (!lit) return null
    const w = document.createTreeWalker(lit, NodeFilter.SHOW_TEXT); let t, hit = null
    while ((t = w.nextNode())) { if (t.nodeValue.includes(n.anchor)) { hit = t; if (!n.anchorLast) break } }
    if (!hit) return null
    const r = document.createRange(), at = hit.nodeValue.lastIndexOf(n.anchor); r.setStart(hit, at); r.setEnd(hit, at + n.anchor.length)
    return r.getBoundingClientRect().top - term.getBoundingClientRect().top + term.scrollTop
  }
  const inView = (elm, at) => { const y = yIn(elm) - at; return y > 20 && y < term.clientHeight - 40 } // is elm visible with the console scrolled to at?
  const yIn = (elm) => elm.getBoundingClientRect().top - term.getBoundingClientRect().top + term.scrollTop
  function emphasize(i, k) {
    log.querySelectorAll('span.qf').forEach((sp) => sp.replaceWith(document.createTextNode(sp.textContent)))
    log.normalize()
    const toks = k >= 0 ? focusOf(i, k).filter(Boolean) : []
    const lit = log.querySelector('.beat.lit')
    if (!toks.length || !lit) return null
    const esc2 = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp('(^|[^\\d.−-])(' + toks.sort((a, b) => b.length - a.length).map(esc2).join('|') + ')(?![\\d])', 'g')
    const walker = document.createTreeWalker(lit, NodeFilter.SHOW_TEXT); const hits = []; let tn
    while ((tn = walker.nextNode())) if (!tn.parentElement.closest('.elide')) hits.push(tn) // omission markers are the page's, not the record's
    let first = null
    for (const t of hits) {
      const v = t.nodeValue; re.lastIndex = 0; let m, last = 0, frag = null
      while ((m = re.exec(v))) {
        frag = frag || document.createDocumentFragment()
        const s0 = m.index + m[1].length
        frag.append(document.createTextNode(v.slice(last, s0)))
        const sp = document.createElement('span'); sp.className = 'qf'; sp.textContent = m[2]; frag.append(sp); first = first || sp
        last = s0 + m[2].length
      }
      if (frag) { frag.append(document.createTextNode(v.slice(last))); t.replaceWith(frag) }
    }
    return first
  }
  function dots(i, k) {
    const sc = S.scenes[i]
    if (!sc.prompt) return $('dots').replaceChildren()
    const n = beatsOf(i).length
    $('dots').replaceChildren(el('span', 'dot q' + (k === -1 ? ' on' : ' seen'), ''), ...Array.from({ length: n }, (_, j) => el('span', 'dot' + (noteOf(i, j) ? ' core' : '') + (j === k ? ' on' : j < k ? ' seen' : ''), '')))
    $('dots').setAttribute('aria-label', k === -1 ? 'Question' : `Part ${k + 1} of ${n}`)
  }

  // ---------- prose panel
  function setSection(i) {
    const sc = S.scenes[i]
    $('secno').textContent = numbered(sc) ? `Section ${String(qNum(i)).padStart(2, '0')} of ${nQ}${sc.post ? ' · after the session' : ''}` : 'Opening'
    $('title').textContent = sc.title
    $('jump').value = String(i)
    setRail(i)
    document.body.classList.toggle('prelude', !sc.prompt)
    $('provtag').textContent = sc.prompt ? 'Real Claude Code session' + (sc.post ? ' · post-session turns' : '') : 'Before the session'
    $('meta').textContent = sc.prompt ? `reply took ${fmt(sc.seconds || 0)}${pace() > 1 ? ` · playing ${pace()}×` : ''}` : ''
    $('meta').title = 'Real time the reply took in the recorded session; playback here is paced for reading'
  }
  // Before the answer, the section's framing. During it, a note where one exists; otherwise the title alone, with the terminal carrying the part.
  function setPhase(i, k) {
    const sc = S.scenes[i]
    const answering = !!sc.prompt && k >= 0
    const note = answering ? noteOf(i, k) : ''
    $('why').hidden = answering // during the answer: the note if there is one; otherwise only the section title stays
    $('why').classList.toggle('recede', answering && !note)
    if (!note) $('why').replaceChildren(...(answering ? sc.prose.slice(0, 1) : sc.prose).map((p) => el('p', '', bold(esc(p)))), ...(sc.fine && !answering ? [el('p', 'fine', esc(sc.fine))] : []))
    $('note').hidden = !note
    if (note) $('note').replaceChildren(...note.split('\n\n').map((t) => el('p', '', qfp(bold(esc(t)), focusOf(i, k)))))
    $('prose').classList.toggle('answering', answering)
    $('status').textContent = sc.prompt ? (k === -1 ? `${numbered(sc) ? 'Section ' + qNum(i) : 'Opening'}: question` : `${numbered(sc) ? 'Section ' + qNum(i) : 'Opening'}, part ${k + 1} of ${beatsOf(i).length}`) : sc.title
    dots(i, k)
    fitProse()
  }
  // The prose keeps one size per role across all screens; a text that does not fit shrinks in steps, and the column scrolls only as a last resort.
  const SCALES = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65] // one size per role; shrink only when a text does not fit
  function fitProse() {
    const pr = $('prose')
    const grow = !pr.classList.contains('answering')
    const fits = () => pr.scrollHeight <= pr.clientHeight + 1
    pr.classList.remove('scrolls')
    let k = 1
    for (const s of SCALES) { if (s > 1 && !grow) continue; k = s; pr.style.setProperty('--k', s); if (fits()) break }
    pr.classList.toggle('scrolls', !fits())
  }
  addEventListener('resize', () => fitProse())
  if (document.fonts) { document.fonts.ready.then(fitProse); document.fonts.addEventListener('loadingdone', fitProse) }
  if (window.ResizeObserver) { let w = 0; new ResizeObserver(([e]) => { if (Math.abs(e.contentRect.width - w) > 1) { w = e.contentRect.width; fitProse() } }).observe($('prose')) }

  // ---------- opening screens: page-authored introduction inside the console (not session output)
  const INTRO = {
    o0: `<div class="prel intro"><div class="pl big" style="--d:200ms">Eric Gladstone</div><div class="pl line dim2" style="--d:700ms">behavioral + computational scientist</div><div class="pl gap" style="--d:1100ms"></div><div class="pl line" style="--d:1400ms">I work across experiments, networks, measurement, simulation, statistical inference, and research systems.</div><div class="pl gap" style="--d:2200ms"></div><div class="pl line" style="--d:2500ms">This is one way I use an AI agent in that work.</div><div class="pl gap" style="--d:3300ms"></div><div class="pl tree" style="--d:3700ms">Real Claude Code session.</div><div class="pl tree" style="--d:4000ms">My questions.</div><div class="pl tree" style="--d:4300ms">Verbatim replies and tool output.</div><div class="pl gap" style="--d:4600ms"></div><div class="pl tree dim2" style="--d:4800ms">The organization and its proposal are fictional,</div><div class="pl tree dim2" style="--d:5000ms">written for this demonstration.</div><div class="pl cursor" style="--d:5500ms">▌</div></div>`,
    o1: `<div class="prel"><div class="pl line dim2" style="--d:200ms">client-brief.md</div><div class="pl gap" style="--d:600ms"></div><div class="pl big" style="--d:800ms">Civic Access Network</div><div class="pl line" style="--d:1400ms">Working brief: evaluating AI support for frontline advisors</div><div class="pl gap" style="--d:2000ms"></div><div class="pl line dim2" style="--d:2300ms">We are considering whether an AI-based assistant could reduce</div><div class="pl line dim2" style="--d:2600ms">some of this administrative and information-search burden.</div><div class="pl cursor" style="--d:3200ms">▌</div></div>`,
    o2: `<div class="prel"><div class="pl line" style="--d:200ms">36 regional teams · roughly 500 frontline advisors</div><div class="pl gap" style="--d:700ms"></div><div class="pl line dim2" style="--d:900ms">summarizing the case history</div><div class="pl line dim2" style="--d:1150ms">retrieving relevant internal guidance</div><div class="pl line dim2" style="--d:1400ms">drafting follow-up messages for the advisor to review</div><div class="pl line dim2" style="--d:1650ms">producing a draft case note from the interaction</div><div class="pl gap" style="--d:2100ms"></div><div class="pl line" style="--d:2400ms">expand the system to all frontline advisors</div><div class="pl line" style="--d:2700ms">expand it only to particular teams, staff groups, or kinds of work</div><div class="pl line" style="--d:3000ms">revise the tool or workflow and test it again</div><div class="pl line" style="--d:3300ms">discontinue it</div><div class="pl cursor" style="--d:3900ms">▌</div></div>`,
    o3: `<div class="prel"><div class="pl line" style="--d:200ms">choose a design</div><div class="pl line" style="--d:600ms">specify how it is measured and analyzed</div><div class="pl line" style="--d:1000ms">generate data under different possible realities</div><div class="pl line" style="--d:1400ms">apply the analysis unchanged</div><div class="pl gap" style="--d:1900ms"></div><div class="pl line dim2" style="--d:2200ms">does it lead to the right decision?</div><div class="pl gap" style="--d:2700ms"></div><div class="pl big" style="--d:3000ms">If not, the design changes</div><div class="pl big" style="--d:3400ms">before anyone is enrolled.</div><div class="pl cursor" style="--d:4000ms">▌</div></div>`,
  }
  // Opening screens: left-side lines come from the data (exact source lines or the author's provenance screen)
  const intro = (sc) => {
    if (sc.left) { log.innerHTML = '<div class="prel intro2">' + sc.left.map((l, j) => `<div class="pl ${l[0]}" style="--d:${200 + j * 280}ms">${esc(l[1])}</div>`).join('') + `<div class="pl cursor" style="--d:${400 + sc.left.length * 280}ms">▌</div></div>`; return }
    if (INTRO[sc.id]) log.innerHTML = INTRO[sc.id]
  }

  // ---------- static render of any step (used for navigation while paused, and as the base for playback)
  // submitted: for k = -1, show the question already sent (in the log) rather than in the input line
  function renderStep(i, k, submitted = false, collapse = false) {
    const sc = S.scenes[i]
    cur = { scene: i, beat: k }
    setSection(i)
    log.replaceChildren(); typed.textContent = ''; spinner.hidden = true
    document.querySelector('.inputbox').classList.remove('typing')
    if (!sc.prompt) intro(sc)
    if (sc.prompt) {
      if (k === -1 && !submitted && !sc.cont) { postLabel(sc); typed.textContent = sc.prompt }
      else {
        postLabel(sc)
        log.append(umsgOf(sc))
        beatsOf(i).forEach((b, j) => { if (j <= k && !b.alias) { const n = beatShell(i, j); fillBeat(n, b, collapse); log.append(n) } })
      }
    }
    spotlight(k)
    setPhase(i, k)
    follow = true; latest.hidden = true
    const lit = log.querySelector('.beat.lit'), mark = log.querySelector('span.qf')
    { const ay = anchorY(i, k); if (ay !== null) { setScroll(ay - Math.round(term.clientHeight * 0.25)); return } }
    if (mark && isAlias(i, k)) { setScroll(yIn(mark) - Math.round(term.clientHeight * 0.35)); return }
    const fig = noteOf(i, k) && lit && lit.querySelector('figure.sfig') // a note on a part with a figure: show the figure
    if (fig) { setScroll(yIn(fig) - 40); return }
    // the lit part sits a little below the top, so the end of the previous part stays in view, dimmed, as context
    const top = lit ? lit.offsetTop - (lit.previousElementSibling ? Math.round(term.clientHeight * 0.22) : 14) : 0
    // unless the note's first highlighted number would then be out of sight (a long part, such as the decision table)
    if (mark && !inView(mark, top)) { setScroll(yIn(mark) - Math.round(term.clientHeight * 0.3)); return }
    setScroll(top)
  }

  // ---------- playback
  async function playFrom(i, k) {
    const my = ++run
    const sc = S.scenes[i]
    cur = { scene: i, beat: k }
    setSection(i)
    try {
      if (!sc.prompt) {
        log.replaceChildren(); typed.textContent = ''; intro(sc); setPhase(i, -1); setScroll(0)
        await sleep(Math.max(9, words(sc.prose.join(' ')) / 3.2 + 3) * 1000, my)
        return advance(my)
      }
      if (k === -1) {
        log.replaceChildren(); typed.textContent = ''; spinner.hidden = true; setScroll(0); postLabel(sc)
        spotlight(-1); setPhase(i, -1)
        // the question types almost at once, then stays in the input line while the framing is read
        if (sc.cont) { log.append(umsgOf(sc)); spotlight(-1); await sleep(2500, my); return advance(my) }
        await sleep(1200, my)
        const t0 = Date.now()
        document.querySelector('.inputbox').classList.add('typing')
        if (REDUCED) typed.textContent = sc.prompt
        else {
          // typing takes at most 15 s at 1× (a long prompt is typed several characters per tick); short prompts type as before
          const full = sc.prompt.length * 15 + (sc.prompt.split('\n').length - 1) * 145
          if (full <= 15000) for (let c = 0; c < sc.prompt.length; c++) { typed.textContent += sc.prompt[c]; await sleep(sc.prompt[c] === '\n' ? 160 : 15, my) }
          else { const per = Math.ceil(sc.prompt.length / (15000 / 40)); for (let c = 0; c < sc.prompt.length; c += per) { typed.textContent = sc.prompt.slice(0, c + per); await sleep(40, my) } }
        }
        const typedFor = (Date.now() - t0) * pace()
        await sleep(Math.max(1500, Math.min(16, words(sc.prose.join(' ')) / 4.5 + 2) * 1000 - typedFor), my)
        typed.textContent = ''
        document.querySelector('.inputbox').classList.remove('typing')
        log.append(umsgOf(sc))
        spotlight(-1)
        spinner.hidden = false
        await sleep(Math.max(2500, Math.min(6000, words(sc.prompt) * 60)), my)
        return advance(my)
      }
      const beat = beatsOf(i)[k]
      if (beat.alias) {
        spotlight(k); setPhase(i, k)
        const ay = anchorY(i, k), mk = log.querySelector('span.qf'); if (ay !== null) setScroll(ay - Math.round(term.clientHeight * 0.25)); else if (mk) setScroll(yIn(mk) - Math.round(term.clientHeight * 0.35))
        await hold(i, k, my)
        return advance(my)
      }
      const node = beatShell(i, k); log.append(node)
      spotlight(k); setPhase(i, k)
      spinner.hidden = false
      await typeBeat(node, beat, my, !!noteOf(i, k))
      spinner.hidden = k >= beatsOf(i).length - 1
      { const f = noteOf(i, k) && node.querySelector('figure.sfig'), ay = anchorY(i, k); if (ay !== null) setScroll(ay - Math.round(term.clientHeight * 0.25)); else if (f) setScroll(yIn(f) - 40)
        else { emphasize(i, k); const mk = noteOf(i, k) && node.querySelector('span.qf'); if (mk && !inView(mk, node.offsetTop + node.offsetHeight - term.clientHeight + 28)) setScroll(yIn(mk) - Math.round(term.clientHeight * 0.3)) } }
      await hold(i, k, my)
      return advance(my)
    } catch (e) { if (e.message !== 'stale') throw e }
  }
  async function typeBeat(node, beat, my, noted) {
    const tools = beat.blocks.filter((b) => b.kind === 'tool').length
    const plan = toolPlan(beat)
    let t = 0
    for (const b of beat.blocks) {
      if (b.kind === 'text') {
        const box = el('div', 'amsg' + (b.cont ? ' cont' : '')); node.append(box)
        const src = b.md
        const step = Math.max(noted ? 4 : 14, Math.ceil(src.length / (noted ? 300 : 100))) // noted parts reveal in ≤12 s, others scan in ≤4 s at 1×
        for (let n = REDUCED ? src.length : 0; n < src.length; n += step) { box.innerHTML = md(src.slice(0, n)) + '<span class="tcur">▍</span>'; followEnd(node); await sleep(40, my) }
        box.innerHTML = md(src); followEnd(node)
        await sleep(300, my)
        continue
      }
      if (b.kind === 'elide') { node.append(el('div', 'elide', esc(b.text))); followEnd(node); await sleep(700, my); continue }
      if (b.kind === 'prompt') { node.append(el('div', 'umsg2', esc(b.text))); followEnd(node); await sleep(2500, my); continue }
      if (b.kind === 'agent') { node.append(agentRep(b)); followEnd(node); await sleep(1800, my); continue }
      if (b.kind === 'bg') { node.append(bgDone(b)); followEnd(node); await sleep(500, my); continue }
      if (b.kind === 'figure') { const f = figure(b); node.append(f); f.querySelector('img').addEventListener('load', () => followEnd(node)); followEnd(node); await sleep(1500, my); continue }
      t++
      if (plan.hide[t - 1]) { if (plan.run[t - 1]) { node.append(el('div', 'note', SHORT(plan.run[t - 1]))); await sleep(1100, my) } continue }
      node.append(toolLines(b)); followEnd(node)
      await sleep(650, my)
    }
  }
  async function hold(i, k, my) {
    const beat = beatsOf(i)[k]
    const text = beat.blocks.map((b) => b.md || '').join(' ')
    const note = noteOf(i, k)
    await sleep((note ? Math.max(7, words(note) / 3.0 + 3) : Math.min(6, 2.5 + words(text) / 120)) * 1000, my)
  }
  function advance(my) {
    if (my !== run) return
    const { scene: i, beat: k } = cur
    if (S.scenes[i].prompt && k < beatsOf(i).length - 1) return playFrom(i, k + 1)
    if (i < S.scenes.length - 1) return playFrom(i + 1, -1)
    setPlaying(false)
  }

  // ---------- navigation
  function go(i, k) {
    inspect(false)
    i = Math.max(0, Math.min(S.scenes.length - 1, i))
    if (!S.scenes[i].prompt) k = -1
    k = Math.min(k, beatsOf(i).length - 1)
    if (!playing) { run++; return renderStep(i, k, true) }
    if (k === -1) return playFrom(i, -1)
    run++
    renderStep(i, k - 1, true, true) // earlier beats already on screen, then type beat k
    playFrom(i, k)
  }
  let present = false
  const core = (i, k) => k === -1 || !!noteOf(i, k)
  function stepBy(d) {
    let { scene: i, beat: k } = cur
    const last = (j) => (S.scenes[j].prompt ? beatsOf(j).length - 1 : -1)
    const one = () => {
      if (d > 0) { if (k < last(i)) k++; else if (i < S.scenes.length - 1) { i++; k = -1 } else return false }
      else if (k > -1) k--
      else if (i > 0) { i--; k = last(i) } else return false
      return true
    }
    // in presenter mode, parts without commentary are passed over (they stay on screen as context)
    do { if (!one()) break } while (present && S.scenes[i].prompt && !core(i, k))
    go(i, k)
  }
  $('present').addEventListener('click', () => {
    present = !present
    $('present').setAttribute('aria-pressed', String(present))
    document.body.classList.toggle('present', present)
    renderStep(cur.scene, cur.beat, true); fitProse()
  })
  function setPlaying(p) {
    playing = p
    $('play').textContent = p ? 'Pause' : 'Play'
    $('play').setAttribute('aria-label', p ? 'Pause' : 'Play')
    document.body.classList.toggle('paused', !p)
    const { scene: i, beat: k } = cur
    run++
    document.querySelector('.inputbox').classList.remove('typing')
    inspect(false)
    if (!p) return renderStep(i, k, true) // paused: the section as it stands, every tool call shown, fully legible
    if (S.scenes[i].prompt && k >= 0) {
      renderStep(i, k, true, true)
      const my = ++run
      sleep(3500, my).then(() => advance(my), () => {})
    } else playFrom(i, k)
  }

  $('play').addEventListener('click', () => setPlaying(!playing))
  $('prev').addEventListener('click', () => stepBy(-1))
  $('next').addEventListener('click', () => stepBy(1))
  $('psec').addEventListener('click', () => go(cur.beat > -1 || !S.scenes[cur.scene].prompt ? cur.scene - (cur.beat > -1 ? 0 : 1) : cur.scene - 1, -1))
  $('nsec').addEventListener('click', () => go(cur.scene + 1, -1))
  $('jump').addEventListener('change', (e) => go(Number(e.target.value), -1))
  $('speed').addEventListener('click', () => { speedIdx = (speedIdx + 1) % speeds.length; $('speed').textContent = `${pace()}×`; setSection(cur.scene) })
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? $('nsec').click() : stepBy(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? $('psec').click() : stepBy(-1) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTerm(-1) }
    else if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomTerm(1) }
  })

  // ---------- viewer-adjustable terminal text size (remembered in this browser only)
  const TZ = [0.7, 0.78, 0.87, 1, 1.12, 1.25, 1.4] // about 1–2 px per step
  let tz = 3
  try { const raw = localStorage.getItem('rehearsal.tz2'); const v = Number(raw); if (raw !== null && raw !== '' && Number.isInteger(v) && v >= 0 && v < TZ.length) tz = v } catch (e) {}
  function zoomTerm(d) {
    tz = Math.max(0, Math.min(TZ.length - 1, tz + d))
    document.querySelector('.screen').style.setProperty('--tz', TZ[tz])
    $('tzdown').disabled = tz === 0; $('tzup').disabled = tz === TZ.length - 1
    $('tzval').textContent = Math.round(parseFloat(getComputedStyle(term).fontSize)) + 'px'
    try { localStorage.setItem('rehearsal.tz2', String(tz)) } catch (e) {}
  }
  $('tzdown').addEventListener('click', () => zoomTerm(-1))
  $('tzup').addEventListener('click', () => zoomTerm(1))
  zoomTerm(0)

  if (S.cwd) $('cwd').textContent = S.cwd
  const q = new URLSearchParams(location.search)
  const start = Number(q.get('s') || 0), startBeat = q.has('b') ? Number(q.get('b')) : -1
  // ?embed=1: the screen fills its frame, for embedding in another page (no floating edge)
  if (q.get('embed') === '1') document.body.classList.add('embed')
  // ?t=12 sets the terminal type to an exact pixel size, for comparing against a real terminal
  if (Number(q.get('t')) > 0) document.querySelector('.screen').style.setProperty('--tsize', `calc(${Number(q.get('t'))}px * var(--tz, 1))`)
  zoomTerm(0)
  if (q.get('play') === '1' && !REDUCED) playFrom(start, -1)
  else { playing = false; document.body.classList.add('paused'); $('play').textContent = 'Play'; $('play').setAttribute('aria-label', 'Play'); renderStep(start, startBeat, true) }
  window.__player = { go, stepBy, setPlaying, get cur() { return cur } }
})()
