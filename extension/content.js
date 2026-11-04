// Luma for YouTube: a "Save to Luma" button next to Like/Share on watch pages and in the header of playlist pages,
// on www.youtube.com and music.youtube.com. Optionally saves a video when the owner likes it.
//
// YouTube is a single-page app that rebuilds its DOM as it pleases, so nothing here holds on to its elements:
// every check looks the anchors up again (after `yt-navigate-finish`, and on DOM changes, throttled to a frame).
;(() => {
  if (window.top !== window || window.__lumaForYouTube) return
  window.__lumaForYouTube = true

  const MUSIC = location.hostname === 'music.youtube.com'
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

  // Where the button goes, most specific first. The first visible match wins.
  const WATCH_ANCHORS = MUSIC
    ? ['ytmusic-player-bar .middle-controls-buttons', 'ytmusic-player-bar #like-button-renderer']
    : [
        'ytd-watch-metadata #top-level-buttons-computed',
        'ytd-watch-metadata #actions #menu',
        '#above-the-fold #top-level-buttons-computed',
        'ytd-video-primary-info-renderer #top-level-buttons-computed',
      ]
  const PLAYLIST_ANCHORS = MUSIC
    ? [
        'ytmusic-responsive-header-renderer .action-buttons',
        'ytmusic-editable-playlist-detail-header-renderer .action-buttons',
        'ytmusic-detail-header-renderer .action-buttons',
      ]
    : [
        'yt-page-header-renderer yt-flexible-actions-view-model',
        '.yt-page-header-view-model__page-header-flexible-actions',
        'ytd-playlist-header-renderer .metadata-buttons-wrapper',
        'ytd-playlist-header-renderer #top-level-buttons-computed',
      ]
  const LIKE_BUTTONS = MUSIC
    ? ['ytmusic-player-bar ytmusic-like-button-renderer #button-shape-like button', 'ytmusic-player-bar ytmusic-like-button-renderer .like']
    : [
        'ytd-watch-metadata like-button-view-model button',
        'ytd-watch-metadata #segmented-like-button button',
        '#above-the-fold like-button-view-model button',
        'ytd-watch-metadata ytd-toggle-button-renderer button',
      ]

  const ICON = `<svg class="luma-mark" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="luma-g" x1=".15" y1=".1" x2=".85" y2=".9"><stop offset="0" stop-color="#8b7dff"/><stop offset="1" stop-color="#ff7ab6"/></linearGradient><mask id="luma-m"><rect width="24" height="24" fill="#fff"/><circle cx="14.6" cy="9.4" r="5.6" fill="#000"/></mask></defs><circle cx="12" cy="12" r="8.5" fill="url(#luma-g)" mask="url(#luma-m)"/></svg>`
  const CHECK = `<svg class="luma-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`

  let settings = { autoSaveLikes: false }
  chrome.storage.sync.get(['autoSaveLikes']).then((s) => (settings = { ...settings, ...s }), () => {})
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoSaveLikes) settings.autoSaveLikes = !!changes.autoSaveLikes.newValue
  })

  // ── What this page is ─────────────────────────────────────────────────

  function videoId() {
    const v = new URLSearchParams(location.search).get('v')
    if (location.pathname === '/watch' && v && VIDEO_ID.test(v)) return v
    const short = /^\/shorts\/([A-Za-z0-9_-]{11})/.exec(location.pathname)
    return short ? short[1] : null
  }

  function playlistId() {
    const list = new URLSearchParams(location.search).get('list')
    if (location.pathname === '/playlist' && list) return list
    const browse = /^\/browse\/VL([A-Za-z0-9_-]+)$/.exec(location.pathname) // music.youtube.com's playlist pages
    return browse ? browse[1] : null
  }

  const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`
  const playlistUrl = (list) => `https://www.youtube.com/playlist?list=${list}`

  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]')

  function find(selectors) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) if (visible(el)) return el
    }
    return null
  }

  // ── Saving ────────────────────────────────────────────────────────────

  function send(url, background) {
    try {
      return chrome.runtime.sendMessage({ type: 'luma-save', url, background }).catch(() => {})
    } catch {
      return Promise.resolve() // the extension was reloaded: this page's script is orphaned until a reload
    }
  }

  function flash(button) {
    button.classList.add('luma-done')
    button.querySelector('.luma-icon').innerHTML = CHECK
    clearTimeout(button._lumaTimer)
    button._lumaTimer = setTimeout(() => {
      button.classList.remove('luma-done')
      button.querySelector('.luma-icon').innerHTML = ICON
    }, 1800)
  }

  function makeButton(kind) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `luma-save luma-save-${kind}${MUSIC ? ' luma-music' : ''}`
    const label = kind === 'playlist' ? 'Save playlist to Luma' : 'Save to Luma'
    button.setAttribute('aria-label', label)
    button.title = label
    button.innerHTML = `<span class="luma-icon">${ICON}</span><span class="luma-label"></span>`
    button.querySelector('.luma-label').textContent = label
    button.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const url = kind === 'playlist' ? playlistId() && playlistUrl(playlistId()) : videoId() && watchUrl(videoId())
      if (!url) return
      flash(button)
      send(url, false)
    })
    return button
  }

  function place(kind, anchors) {
    const existing = document.querySelector(`.luma-save-${kind}`)
    const wanted = kind === 'playlist' ? playlistId() : videoId()
    const anchor = wanted ? find(anchors) : null
    if (!anchor) return void existing?.remove()
    if (existing && existing.parentElement === anchor && visible(existing)) return
    existing?.remove()
    anchor.append(makeButton(kind))
  }

  function inject() {
    place('watch', WATCH_ANCHORS)
    place('playlist', PLAYLIST_ANCHORS)
  }

  // ── Auto-save liked videos ────────────────────────────────────────────
  // A like counts only when the owner pressed the button just before, and it is still on after a short pause.
  // Page loads and navigation set a fresh baseline for each video, so an already-liked video is never saved.

  const LIKE_SELECTOR = LIKE_BUTTONS.join(',')
  const savedLikes = new Set()
  let liked = { video: null, pressed: false }
  let pressedAt = 0
  let pending = null

  const likeButton = () => find(LIKE_BUTTONS)
  const isPressed = (button) => {
    const renderer = button.closest('ytmusic-like-button-renderer')
    if (renderer?.hasAttribute('like-status')) return renderer.getAttribute('like-status') === 'LIKE'
    return button.getAttribute('aria-pressed') === 'true'
  }

  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof Element && e.target.closest(LIKE_SELECTOR)) pressedAt = Date.now()
    },
    true,
  )

  function checkLike() {
    const button = likeButton()
    const video = videoId()
    if (!button || !video) return
    const pressed = isPressed(button)
    if (video !== liked.video) {
      clearTimeout(pending)
      liked = { video, pressed }
      return
    }
    if (pressed && !liked.pressed && settings.autoSaveLikes && Date.now() - pressedAt < 4000 && !savedLikes.has(video)) {
      clearTimeout(pending)
      pending = setTimeout(() => {
        const now = likeButton()
        if (!now || videoId() !== video || !isPressed(now) || savedLikes.has(video)) return
        savedLikes.add(video)
        const ours = document.querySelector('.luma-save-watch')
        if (ours) flash(ours)
        send(watchUrl(video), true)
      }, 1200)
    } else if (!pressed) clearTimeout(pending) // unliked within the pause
    liked.pressed = pressed
  }

  // ── Wiring ────────────────────────────────────────────────────────────

  let frame = 0
  const update = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      inject()
      checkLike()
    })
  }

  for (const event of ['yt-navigate-finish', 'yt-page-data-updated', 'popstate']) window.addEventListener(event, update)
  document.addEventListener('yt-navigate-finish', update)
  new MutationObserver(update).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-pressed', 'like-status', 'hidden'],
  })
  update()
})()
