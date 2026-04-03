// Patatin — based on xbox-ui-windows by ecnivtwelve
const fs = require('fs');
const path = require('path');
const https = require('https');
const cp = require('child_process');
const { ipcRenderer } = require('electron');
const os = require('os');

// ===== Config paths =====
const documents = path.join(os.homedir(), 'Documents');
const xboxDir = path.join(documents, 'Xbox');
const assetsDir = path.join(xboxDir, 'Assets');
[xboxDir, assetsDir].forEach(d => { try { fs.mkdirSync(d, { recursive: true }); } catch {} });

const STEAM_ROOT = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].find(p => fs.existsSync(path.join(p, 'steam.exe'))) || '';
const STEAM_CACHE = path.join(STEAM_ROOT, 'appcache', 'librarycache');

// ===== Profile =====
const gamertagFile = path.join(assetsDir, 'gamertag.txt');
const descFile = path.join(assetsDir, 'gamerdescription.txt');
const colorFile = path.join(assetsDir, 'gamercolor.txt');
const wallpaperFile = path.join(assetsDir, 'video.mp4');
const profilepicFile = path.join(assetsDir, 'gamerpic.png');

if (!fs.existsSync(gamertagFile)) fs.writeFileSync(gamertagFile, 'Patatin');
if (!fs.existsSync(descFile)) fs.writeFileSync(descFile, os.userInfo().username);
if (!fs.existsSync(colorFile)) fs.writeFileSync(colorFile, '#14b413');

const gamertag_full = fs.readFileSync(gamertagFile, 'utf8').trim();
$('#gamertag').html(gamertag_full);
$('#gamerdescription').html(fs.readFileSync(descFile, 'utf8').trim());

const themeColor = fs.readFileSync(colorFile, 'utf8').trim();
document.querySelector(':root').style.setProperty('--theme-color', themeColor);

if (fs.existsSync(profilepicFile)) {
  document.getElementById('profilepic').src = profilepicFile;
} else {
  document.getElementById('profilepic').style.cssText = 'width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#2d8c2d,#1a5c1a);';
}

// ===== INSTANT BOOT (no startup video) =====
$('#dashboard').css('display', 'block');
setTimeout(() => {
  new Audio('assets/login.mp3').play().catch(() => {});
  $('#dashboard').append(`<div class="login">
    <img class="log_img" src="${fs.existsSync(profilepicFile) ? profilepicFile : ''}" onerror="this.style.display='none'">
    <p class="log_txt">Welcome, ${gamertag_full}</p>
  </div>`);
}, 500);

// ===== Clock =====
setInterval(() => {
  document.getElementById('time').innerHTML =
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}, 1000);

// ===== EA ART LOOKUP =====
const EA_ART = {
  'Plants vs Zombies Garden Warfare 2': {
    tile: 'C:/Program Files/EA Games/Plants vs Zombies Garden Warfare 2/EAAntiCheat.splash.png',
    hero: 'https://media.contentapi.ea.com/content/dam/gin/images/2016/01/pvzgw2-plantsvszombiesgardenwarfare2-background-key-art.jpg',
  },
};

// ===== GAME DETECTION =====
function parseVDF(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*"([^"]+)"\s+"([^"]*)"$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function detectSteamGames() {
  const games = [];
  if (!STEAM_ROOT) return games;

  const libraryFolders = [path.join(STEAM_ROOT, 'steamapps')];
  const libVdf = path.join(STEAM_ROOT, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(libVdf)) {
    for (const m of fs.readFileSync(libVdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) {
      const appsDir = path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps');
      if (fs.existsSync(appsDir) && !libraryFolders.includes(appsDir)) libraryFolders.push(appsDir);
    }
  }

  for (const appsDir of libraryFolders) {
    let files; try { files = fs.readdirSync(appsDir); } catch { continue; }
    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
      const appId = file.replace('appmanifest_', '').replace('.acf', '');
      const manifest = parseVDF(fs.readFileSync(path.join(appsDir, file), 'utf8'));
      if (!manifest.name || manifest.name === 'Steamworks Common Redistributables') continue;
      // Only fully installed games (StateFlags 4)
      if (manifest.StateFlags && manifest.StateFlags !== '4') continue;
      // Deduplicate by appId
      if (games.some(g => g.appId === appId)) continue;

      const localCache = path.join(STEAM_CACHE, appId);
      const localTile = path.join(localCache, 'library_600x900.jpg');
      const localHeroBlur = path.join(localCache, 'library_hero_blur.jpg');
      const localHero = path.join(localCache, 'library_hero.jpg');
      const localLogo = path.join(localCache, 'logo.png');

      // Find the actual game exe to launch directly (bypasses Big Picture)
      const installDir = manifest.installdir;
      const gamePath = path.join(appsDir, 'common', installDir);
      let gameExe = null;
      try {
        const exes = fs.readdirSync(gamePath).filter(f =>
          f.endsWith('.exe') && !/unins|crash|report|redist|setup|launch|anticheat|vc_redist/i.test(f)
        );
        if (exes.length > 0) gameExe = path.join(gamePath, exes[0]);
      } catch {}

      games.push({
        name: manifest.name, appId, platform: 'steam', installed: true,
        art: fs.existsSync(localTile) ? localTile : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        heroBlur: fs.existsSync(localHeroBlur) ? localHeroBlur : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero_blur.jpg`,
        hero: fs.existsSync(localHero) ? localHero : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
        logo: fs.existsSync(localLogo) ? localLogo : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`,
        launch: gameExe ? gameExe : `steam://rungameid/${appId}`,
        exe: gameExe,
      });
    }
  }
  return games;
}

function detectEAGames() {
  const games = [];
  const eaPaths = ['C:\\Program Files\\EA Games', 'C:\\Program Files (x86)\\EA Games'];
  for (const eaRoot of eaPaths) {
    if (!fs.existsSync(eaRoot)) continue;
    for (const dir of fs.readdirSync(eaRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const gamePath = path.join(eaRoot, dir.name);
      const eaArt = EA_ART[dir.name] || {};
      const splash = path.join(gamePath, 'EAAntiCheat.splash.png');

      // Find the EA game launcher exe
      let eaExe = null;
      try {
        const exes = fs.readdirSync(gamePath).filter(f =>
          f.endsWith('.exe') && !/unins|anticheat|setup|redist/i.test(f)
        );
        if (exes.length > 0) eaExe = path.join(gamePath, exes[0]);
      } catch {}

      games.push({
        name: dir.name, platform: 'ea', installed: true,
        art: eaArt.tile || (fs.existsSync(splash) ? splash : null),
        heroBlur: eaArt.hero || null,
        hero: eaArt.hero || null,
        logo: null,
        launch: eaExe,
        exe: eaExe,
      });
    }
  }
  return games;
}

// ===== POPULATE =====
const allGames = [...detectSteamGames(), ...detectEAGames()];

// No mock data — show real installed games only

const $gamelist = $('#gamelist');
$gamelist.empty();
allGames.slice(0, 8).forEach((game, i) => {
  const classes = i === 0 ? 'game latest' : 'game';
  const $tile = $(`<div class="${classes}" id="game-${i}"></div>`);
  if (game.art) {
    $tile.css('background-image', `url('${game.art.replace(/\\/g, '/')}')`);
  } else {
    const hue = (i * 47) % 360;
    $tile.css('background', `linear-gradient(135deg, hsl(${hue},40%,25%), hsl(${hue+60},30%,15%))`);
    $tile.html(`<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:14px;font-weight:600;padding:12px;text-align:center">${game.name}</span>`);
  }
  const badge = game.platform === 'steam' ? 'STEAM' : game.platform === 'ea' ? 'EA' : '';
  if (badge) $tile.append(`<div class="platform-badge">${badge}</div>`);
  $tile.data('game', game);
  $gamelist.append($tile);
});

// Featured tile bg
if (allGames.length > 0) {
  const fa = allGames[Math.min(3, allGames.length - 1)].art;
  if (fa) document.getElementById('util-ea-bg').style.backgroundImage = `url('${(fa+'').replace(/\\/g, '/')}')`;
}

// ===== CUSTOM ZONE NAVIGATION (replaces DomNavigator) =====
const zones = ['games', 'utilities'];
let currentZone = 'games';
let currentIndex = 0;
let shutdownOpen = false;
let shutdownIndex = 0;
let mygamesOpen = false;
let ytMode = false;

function getZoneElements(zone) {
  if (zone === 'games') return Array.from(document.querySelectorAll('#gamelist .game'));
  if (zone === 'utilities') return Array.from(document.querySelectorAll('#utilityrow .utile'));
  return [];
}

function updateSelection() {
  document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
  const items = getZoneElements(currentZone);
  if (items[currentIndex]) {
    items[currentIndex].classList.add('selected');
    items[currentIndex].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
  // Update hero background + music when on games
  if (currentZone === 'games') {
    const game = $(items[currentIndex]).data('game');
    updateBackground(game);
    playGameMusic(game);
  } else {
    updateBackground(null);
    playGameMusic(null);
  }
}

function navigate(direction) {
  if (shutdownOpen) { navigateShutdown(direction); return; }
  if (contextMenuOpen) { navigateContext(direction); return; }
  if (mygamesOpen) { return; } // TODO: my games nav
  const items = getZoneElements(currentZone);
  switch (direction) {
    case 'left':  currentIndex = Math.max(0, currentIndex - 1); break;
    case 'right': currentIndex = Math.min(items.length - 1, currentIndex + 1); break;
    case 'up': {
      const zi = zones.indexOf(currentZone);
      if (zi > 0) { currentZone = zones[zi - 1]; currentIndex = Math.min(currentIndex, getZoneElements(currentZone).length - 1); }
      break;
    }
    case 'down': {
      const zj = zones.indexOf(currentZone);
      if (zj < zones.length - 1) { currentZone = zones[zj + 1]; currentIndex = Math.min(currentIndex, getZoneElements(currentZone).length - 1); }
      break;
    }
  }
  updateSelection();
}

// Init first selection
setTimeout(() => updateSelection(), 100);

// ===== GAME MUSIC ON HOVER =====
const GAME_MUSIC = {};
// Map appId/game name to music file
const musicDir = path.join(__dirname, '..', 'cache', 'music');
// Skyrim
['mus_maintheme.wma', 'mus_explore_day_01.wma', 'mus_sovngarde_chant_lp.wma'].forEach(f => {
  const p = path.join(musicDir, '72850', f);
  if (fs.existsSync(p)) { if (!GAME_MUSIC['72850']) GAME_MUSIC['72850'] = []; GAME_MUSIC['72850'].push(p); }
});
// PvZ GW2
const pvzMusic = path.join(musicDir, 'pvz', 'main_theme.mp3');
if (fs.existsSync(pvzMusic)) GAME_MUSIC['pvz'] = [pvzMusic];
// LEGO Star Wars
const swDir = path.join(musicDir, '920210');
if (fs.existsSync(swDir)) {
  const swFiles = fs.readdirSync(swDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wma') || f.endsWith('.ogg'));
  if (swFiles.length > 0) GAME_MUSIC['920210'] = swFiles.map(f => path.join(swDir, f));
}

let currentAudio = null;
let currentMusicKey = null;
let musicFadeTimer = null;
let musicDelayTimer = null;
let musicTrackIndex = 0;

function playGameMusic(game) {
  const key = game ? (game.appId || game.platform) : null;
  const musicKey = key && GAME_MUSIC[key] ? key : (game && game.platform === 'ea' && GAME_MUSIC['pvz'] ? 'pvz' : null);

  if (musicKey === currentMusicKey) return;

  // Clear any pending fade-in
  clearTimeout(musicDelayTimer);
  clearInterval(musicFadeTimer);

  // Fade out current
  if (currentAudio) {
    const dying = currentAudio;
    const fadeOut = setInterval(() => {
      if (dying.volume > 0.02) { dying.volume -= 0.02; }
      else { dying.pause(); dying.currentTime = 0; clearInterval(fadeOut); }
    }, 50);
    currentAudio = null;
  }

  currentMusicKey = musicKey;
  if (!musicKey || !GAME_MUSIC[musicKey]) return;

  // Delay 600ms before starting music (so quick scrolling doesn't spam)
  musicDelayTimer = setTimeout(() => {
    const tracks = GAME_MUSIC[musicKey];
    musicTrackIndex = Math.floor(Math.random() * tracks.length);
    startTrack(tracks, musicTrackIndex);
  }, 600);
}

function startTrack(tracks, idx) {
  const pick = tracks[idx % tracks.length];
  currentAudio = new Audio(pick.replace(/\\/g, '/'));
  currentAudio.volume = 0;
  currentAudio.play().catch(() => {});

  // Fade in slowly
  musicFadeTimer = setInterval(() => {
    if (currentAudio && currentAudio.volume < 0.3) {
      currentAudio.volume = Math.min(0.3, currentAudio.volume + 0.01);
    } else {
      clearInterval(musicFadeTimer);
    }
  }, 60);

  // When track ends, crossfade to next
  currentAudio.addEventListener('ended', () => {
    musicTrackIndex++;
    startTrack(tracks, musicTrackIndex);
  });
}

// ===== HERO BACKGROUND =====
function updateBackground(game) {
  const $wp = $('#wallpaper-img');
  const $logo = $('#game-logo');
  if (!game) {
    $wp.css('opacity', '0');
    $logo.css('display', 'none');
    return;
  }
  // Use unblurred hero image as background
  const heroSrc = game.hero || game.heroBlur;
  if (heroSrc) {
    $wp.attr('src', (heroSrc + '').replace(/\\/g, '/'));
    $wp.css('opacity', '0.35');
  }
  if (game.logo) {
    $logo.attr('src', (game.logo + '').replace(/\\/g, '/'));
    $logo.css('display', 'block');
  } else {
    $logo.css('display', 'none');
  }
}

// ===== SOUNDS =====
const nav_sound_pool = [];
for (let i = 0; i < 5; i++) nav_sound_pool.push(new Audio('assets/navigate.mp3'));
let nav_sound_idx = 0;
function playNavSound() {
  const snd = nav_sound_pool[nav_sound_idx % nav_sound_pool.length];
  snd.currentTime = 0;
  snd.play().catch(() => {});
  nav_sound_idx++;
}

// ===== CONTROLLER =====
Controller.search();

window.addEventListener('gc.controller.found', function(event) {
  notify('assets/controller.jpeg', 'Xbox controller connected to Patatin.');
}, false);
window.addEventListener('gc.controller.lost', function(event) {
  notify('assets/controller.jpeg', 'Xbox controller disconnected.');
}, false);

window.addEventListener('gc.button.press', function(event) {
  const btn = event.detail.name;

  // When YouTube TV is active, forward controller as keyboard to the BrowserView
  if (ytMode) {
    if (btn === 'DPAD_LEFT')  ipcRenderer.send('yt-key', 'Left');
    if (btn === 'DPAD_RIGHT') ipcRenderer.send('yt-key', 'Right');
    if (btn === 'DPAD_UP')    ipcRenderer.send('yt-key', 'Up');
    if (btn === 'DPAD_DOWN')  ipcRenderer.send('yt-key', 'Down');
    if (btn === 'FACE_1')     ipcRenderer.send('yt-key', 'Return');   // A = Enter/Select
    if (btn === 'FACE_2')     { ipcRenderer.send('yt-key', 'Escape'); } // B = Back
    if (btn === 'FACE_3')     ipcRenderer.send('yt-key', 'Space');    // X = Play/Pause
    if (btn === 'FACE_4')     ipcRenderer.send('yt-key', 'Return');   // Y = Search/Enter
    if (btn === 'LEFT_SHOULDER')  ipcRenderer.send('yt-key', 'MediaPreviousTrack'); // LB = Prev
    if (btn === 'RIGHT_SHOULDER') ipcRenderer.send('yt-key', 'MediaNextTrack');     // RB = Next
    if (btn === 'SELECT') {
      // Back/View button = close YouTube, return to Patatin
      ytMode = false;
      ipcRenderer.send('close-youtube');
    }
    if (btn === 'START') {
      // Start = toggle fullscreen in YouTube
      ipcRenderer.send('yt-key', 'f');
    }
    return;
  }

  // Normal Patatin navigation
  if (btn === 'DPAD_LEFT')  { navigate('left'); playNavSound(); }
  if (btn === 'DPAD_RIGHT') { navigate('right'); playNavSound(); }
  if (btn === 'DPAD_UP')    { navigate('up'); playNavSound(); }
  if (btn === 'DPAD_DOWN')  { navigate('down'); playNavSound(); }
  if (btn === 'FACE_1') handleA();    // A
  if (btn === 'FACE_2') handleB();    // B
  if (btn === 'FACE_4') {
    ipcRenderer.send('open-youtube');
    ytMode = true;
  }
  if (btn === 'START') handleStartMenu();
}, false);

window.addEventListener('gc.analog.start', function(event) {
  const pos = event.detail.position;
  if (ytMode) {
    // Forward analog stick to YouTube TV
    if (pos.x < -0.3) ipcRenderer.send('yt-key', 'Left');
    if (pos.x > 0.3)  ipcRenderer.send('yt-key', 'Right');
    if (pos.y < -0.3) ipcRenderer.send('yt-key', 'Up');
    if (pos.y > 0.3)  ipcRenderer.send('yt-key', 'Down');
    return;
  }
  if (pos.x < -0.3) { navigate('left'); playNavSound(); }
  if (pos.x > 0.3)  { navigate('right'); playNavSound(); }
  if (pos.y < -0.3) { navigate('up'); playNavSound(); }
  if (pos.y > 0.3)  { navigate('down'); playNavSound(); }
}, false);

// Keyboard
document.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowLeft')  { navigate('left'); playNavSound(); }
  if (e.key === 'ArrowRight') { navigate('right'); playNavSound(); }
  if (e.key === 'ArrowUp')    { navigate('up'); playNavSound(); }
  if (e.key === 'ArrowDown')  { navigate('down'); playNavSound(); }
  if (e.key === 'Enter' || e.key === ' ') handleA();
  if (e.key === 'Escape') handleB();
});

// ===== ACTIONS =====
function handleA() {
  if (shutdownOpen) { confirmShutdown(); return; }
  if (contextMenuOpen) { confirmContext(); return; }
  if (mygamesOpen) { return; } // TODO
  launchSelected();
}

// ===== GAME CONTEXT MENU (Start button) =====
let contextMenuOpen = false;
let contextMenuIndex = 0;

function handleStartMenu() {
  if (shutdownOpen || mygamesOpen || contextMenuOpen) return;
  if (currentZone !== 'games') return;
  const items = getZoneElements('games');
  const game = $(items[currentIndex]).data('game');
  if (!game) return;
  openContextMenu(game);
}

function openContextMenu(game) {
  contextMenuOpen = true;
  contextMenuIndex = 0;
  const $overlay = $('#context-overlay');
  const $title = $('#context-title');
  const $opts = $('#context-options');
  $title.text(game.name);
  $opts.empty();

  // "Quit game" — kills the game process if running
  if (game.installed) {
    $opts.append(`<div class="context-option selected" data-action="quit">Quit game</div>`);
    $opts.append(`<div class="context-option" data-action="launch">Launch game</div>`);
  }
  if (game.appId && game.platform === 'steam') {
    $opts.append(`<div class="context-option" data-action="store">View in Store</div>`);
  }
  $opts.append(`<div class="context-option" data-action="cancel">Cancel</div>`);

  $overlay.data('game', game);
  $overlay.css('display', 'flex');
  updateContextSelection();
}

function closeContextMenu() {
  contextMenuOpen = false;
  $('#context-overlay').css('display', 'none');
}

function navigateContext(dir) {
  const opts = document.querySelectorAll('#context-options .context-option');
  if (dir === 'up') contextMenuIndex = Math.max(0, contextMenuIndex - 1);
  if (dir === 'down') contextMenuIndex = Math.min(opts.length - 1, contextMenuIndex + 1);
  updateContextSelection();
}

function updateContextSelection() {
  document.querySelectorAll('#context-options .context-option').forEach((el, i) => {
    el.classList.toggle('selected', i === contextMenuIndex);
  });
}

function confirmContext() {
  const opts = document.querySelectorAll('#context-options .context-option');
  const action = opts[contextMenuIndex]?.dataset.action;
  const game = $('#context-overlay').data('game');

  if (action === 'quit' && game) {
    // Kill the game process — try by exe name derived from game name
    if (game.platform === 'steam' && game.appId) {
      // steam://nav/games shows running games; steam://close/{appId} doesn't exist
      // Best approach: taskkill by finding the process
      const { exec } = require('child_process');
      // For Steam games, tell Steam to stop the game
      exec(`start "" "steam://gamepadui/running"`, () => {});
      ipcRenderer.send('launch-uri', `steam://nav/games`);
    }
  } else if (action === 'launch' && game && game.launch) {
    ipcRenderer.send('launch-uri', game.launch);
  } else if (action === 'store' && game && game.appId) {
    ipcRenderer.send('launch-uri', `steam://store/${game.appId}`);
  }
  closeContextMenu();
}

function handleB() {
  if (shutdownOpen) { closeShutdownOverlay(); return; }
  if (contextMenuOpen) { closeContextMenu(); return; }
  if (mygamesOpen) { closeMygamesOverlay(); return; }
  if (ytMode) { ytMode = false; ipcRenderer.send('close-youtube'); return; }
}

function launchSelected() {
  const items = getZoneElements(currentZone);
  const $el = $(items[currentIndex]);
  const game = $el.data('game');
  if (game) {
    if (game.installed && game.exe) {
      // Launch directly via exe — bypasses Steam Big Picture entirely
      ipcRenderer.send('launch-exe', game.exe);
    } else if (game.installed && game.launch) {
      ipcRenderer.send('launch-uri', game.launch);
    } else if (!game.installed && game.appId) {
      ipcRenderer.send('launch-uri', `steam://install/${game.appId}`);
    }
    return;
  }
  // Utility tile
  const id = $el.attr('id');
  if (id === 'util-mygames') openMygamesOverlay();
  else if (id === 'util-youtube') { ipcRenderer.send('open-youtube'); ytMode = true; }
  else if (id === 'util-ea') ipcRenderer.send('launch-uri', 'com.electronicarts.ea-desktop://main');
}

// ===== SHUTDOWN OVERLAY =====
function openShutdownOverlay() {
  shutdownOpen = true;
  shutdownIndex = 0;
  $('#shutdown-overlay').css('display', 'flex');
  updateShutdownSelection();
}

function closeShutdownOverlay() {
  shutdownOpen = false;
  $('#shutdown-overlay').css('display', 'none');
}

function navigateShutdown(dir) {
  const opts = document.querySelectorAll('.shutdown-option');
  if (dir === 'up') shutdownIndex = Math.max(0, shutdownIndex - 1);
  if (dir === 'down') shutdownIndex = Math.min(opts.length - 1, shutdownIndex + 1);
  updateShutdownSelection();
}

function updateShutdownSelection() {
  document.querySelectorAll('.shutdown-option').forEach((el, i) => {
    el.classList.toggle('selected', i === shutdownIndex);
  });
}

function confirmShutdown() {
  const opts = document.querySelectorAll('.shutdown-option');
  const action = opts[shutdownIndex]?.dataset.action;
  if (action === 'close') ipcRenderer.send('quit-app');
  else if (action === 'restart') cp.exec('shutdown /r /t 0');
  else if (action === 'shutdown') cp.exec('shutdown /s /t 0');
  closeShutdownOverlay();
}

// Listen for shutdown overlay trigger from main process (F23 long press)
ipcRenderer.on('show-shutdown-overlay', () => openShutdownOverlay());

// ===== MY GAMES & APPS OVERLAY =====
function openMygamesOverlay() {
  mygamesOpen = true;
  $('#mygames-overlay').css('display', 'block');
  populateMygames();
}

function closeMygamesOverlay() {
  mygamesOpen = false;
  $('#mygames-overlay').css('display', 'none');
}

function populateMygames() {
  const $grid = $('#mygames-grid');
  $grid.empty();

  // Show installed games
  allGames.forEach((game, i) => {
    const $tile = $(`<div class="mg-tile"></div>`);
    if (game.art) $tile.css('background-image', `url('${(game.art+'').replace(/\\/g, '/')}')`);
    $tile.append(`<div class="mg-name">${game.name}</div>`);
    $grid.append($tile);
  });

  // Fetch featured non-installed games
  fetchFeaturedGames().then(featured => {
    const installedIds = new Set(allGames.map(g => g.appId));
    const notInstalled = featured.filter(g => !installedIds.has(g.appId)).slice(0, 8);
    notInstalled.forEach(game => {
      const $tile = $(`<div class="mg-tile not-installed"></div>`);
      if (game.art) $tile.css('background-image', `url('${game.art}')`);
      $tile.append(`<div class="install-badge">GET</div>`);
      if (game.price) $tile.append(`<div class="price-badge">${game.price}</div>`);
      $tile.append(`<div class="mg-name">${game.name}</div>`);
      $tile.data('game', game);
      $grid.append($tile);
    });
  });
}

function fetchFeaturedGames() {
  return new Promise((resolve) => {
    https.get('https://store.steampowered.com/api/featured/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const featured = (json.featured_win || []).map(g => ({
            name: g.name, appId: String(g.id), platform: 'steam', installed: false,
            art: g.large_capsule_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/library_600x900.jpg`,
            launch: `steam://install/${g.id}`,
            price: g.final_price ? (g.final_price === 0 ? 'Free' : `$${(g.final_price / 100).toFixed(2)}`) : '',
          }));
          resolve(featured);
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

// ===== NOTIFICATIONS =====
const notification_sound = new Audio('assets/notification.mp3');
function notify(img, text) {
  setTimeout(() => { notification_sound.play().catch(() => {}); }, 100);
  $('#dashboard').append(`<div class="new-notification">
    <img class="not_img" src="${img}" onerror="this.style.display='none'">
    <p class="not_txt">${text}</p>
  </div>`);
}

// ===== FPS =====
const times = [];
function refreshLoop() {
  window.requestAnimationFrame(() => {
    const now = performance.now();
    while (times.length > 0 && times[0] <= now - 1000) times.shift();
    times.push(now);
    $('#fps').html(times.length + ' fps');
    refreshLoop();
  });
}
refreshLoop();
let fpsdisplay = false;
window.addEventListener('keypress', function(e) {
  if (e.key === 'f') { fpsdisplay = !fpsdisplay; $('#fps').css('display', fpsdisplay ? 'block' : 'none'); }
});
