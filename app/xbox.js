// Patatin — Linux port
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

// Windows SSD mounted read-only
const WINDOWS_MNT = ['/mnt/windows', '/media/' + os.userInfo().username + '/WINDOWS'].find(p => fs.existsSync(p)) || '';
const STEAM_PATHS = [
  path.join(WINDOWS_MNT, 'Program Files (x86)', 'Steam'),
  path.join(WINDOWS_MNT, 'Program Files', 'Steam'),
].filter(p => fs.existsSync(p));
const STEAM_ROOT = STEAM_PATHS[0] || '';

// Games that won't work on Linux (kernel-level anti-cheat)
const WINDOWS_ONLY = new Set(['Call of Duty HQ', 'Call of Duty', 'Battlefield 6']);
const ONLINE_BLOCKED = new Set(['Rocket League', 'rocketleague']);
const HIDDEN_APPS = new Set([
  'Wallpaper Engine', 'wallpaper_engine', 'Steamworks Common Redistributables',
  'Steam Controller Configs', 'Steamworks Shared', 'Proton Experimental',
  'Proton EasyAntiCheat Runtime', 'Proton BattlEye Runtime',
  'Steam Linux Runtime', 'Steam Linux Runtime - Soldier', 'Steam Linux Runtime - Sniper',
  'LEGO® Star Wars™: The Skywalker Saga', 'LEGO Star Wars - The Skywalker Saga',
  'Oblivion Remastered',
]);

// ===== Profile =====
const gamertagFile = path.join(assetsDir, 'gamertag.txt');
const descFile = path.join(assetsDir, 'gamerdescription.txt');
const colorFile = path.join(assetsDir, 'gamercolor.txt');
const wallpaperFile = path.join(assetsDir, 'video.mp4');
const profilepicFile = path.join(assetsDir, 'gamerpic.png');

if (!fs.existsSync(gamertagFile)) fs.writeFileSync(gamertagFile, os.userInfo().username);
if (!fs.existsSync(descFile)) fs.writeFileSync(descFile, 'Linux Gaming');
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

// ===== INSTANT BOOT =====
let hasMovedOnce = false;
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

// ===== AUTO-NORMALIZE MUSIC =====
(function normalizeMusic() {
  let ffmpegPath;
  try { ffmpegPath = require('ffmpeg-static'); } catch { return; }
  const cacheDir = path.join(__dirname, '..', 'cache', 'music');
  if (!fs.existsSync(cacheDir)) return;

  function findMp3s(dir) {
    let results = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results = results.concat(findMp3s(full));
        else if (entry.name.endsWith('.mp3')) results.push(full);
      }
    } catch {}
    return results;
  }

  const mp3s = findMp3s(cacheDir);
  mp3s.forEach(f => {
    const flag = f + '.normalized';
    if (fs.existsSync(flag)) return;
    const tmp = f + '.tmp.mp3';
    try {
      cp.execSync('"' + ffmpegPath + '" -y -i "' + f + '" -af loudnorm=I=-16:TP=-1.5:LRA=11 -q:a 2 "' + tmp + '"',
        { shell: true, stdio: 'pipe' });
      fs.unlinkSync(f);
      fs.renameSync(tmp, f);
      fs.writeFileSync(flag, 'done');
    } catch {
      try { fs.unlinkSync(tmp); } catch {}
    }
  });
})();

// ===== EA ART LOOKUP =====
const EA_ART = {
  'Plants vs Zombies Garden Warfare 2': {
    tile: 'https://cdn.cloudflare.steamstatic.com/steam/apps/590390/header.jpg',
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
  if (!WINDOWS_MNT) return games;

  // Find all Steam library folders on the Windows SSD
  const libraryFolders = [];
  for (const steamPath of STEAM_PATHS) {
    const appsDir = path.join(steamPath, 'steamapps');
    if (fs.existsSync(appsDir)) libraryFolders.push(appsDir);

    const libVdf = path.join(appsDir, 'libraryfolders.vdf');
    if (fs.existsSync(libVdf)) {
      for (const m of fs.readFileSync(libVdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) {
        // These are Windows paths — try to map them to the mount
        const winPath = m[1].replace(/\\\\/g, '\\');
        // Check if it's on the same drive (e.g., backup SteamLibrary)
        const possiblePaths = [
          path.join(WINDOWS_MNT, 'Users', 'Alden Bernstein', 'Cross-Plat-Games', 'SteamLibrary', 'steamapps'),
        ];
        for (const pp of possiblePaths) {
          if (fs.existsSync(pp) && !libraryFolders.includes(pp)) libraryFolders.push(pp);
        }
      }
    }
  }

  // Also directly check backup SteamLibrary
  const backupSteam = path.join(WINDOWS_MNT, 'Users', 'Alden Bernstein', 'Cross-Plat-Games', 'SteamLibrary', 'steamapps');
  if (fs.existsSync(backupSteam) && !libraryFolders.includes(backupSteam)) {
    libraryFolders.push(backupSteam);
  }

  const seenAppIds = new Set();

  for (const appsDir of libraryFolders) {
    let files; try { files = fs.readdirSync(appsDir); } catch { continue; }
    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
      const appId = file.replace('appmanifest_', '').replace('.acf', '');
      if (seenAppIds.has(appId)) continue;
      seenAppIds.add(appId);

      const manifest = parseVDF(fs.readFileSync(path.join(appsDir, file), 'utf8'));
      if (!manifest.name) continue;
      if (HIDDEN_APPS.has(manifest.name)) continue;
      if (manifest.StateFlags && manifest.StateFlags !== '4') continue;

      let compatibility = 'proton';
      if (WINDOWS_ONLY.has(manifest.name)) compatibility = 'windows-only';
      else if (ONLINE_BLOCKED.has(manifest.name)) compatibility = 'online-blocked';

      games.push({
        name: manifest.name, appId, platform: 'steam', installed: true,
        compatibility,
        art: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        heroBlur: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero_blur.jpg`,
        hero: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
        logo: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`,
        launch: `steam://rungameid/${appId}`,
        exe: null,
      });
    }
  }
  return games;
}

function detectEAGames() {
  const games = [];
  const eaPaths = [
    path.join(WINDOWS_MNT, 'Program Files', 'EA Games'),
    path.join(WINDOWS_MNT, 'Program Files (x86)', 'EA Games'),
  ];
  for (const eaRoot of eaPaths) {
    if (!fs.existsSync(eaRoot)) continue;
    for (const dir of fs.readdirSync(eaRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const gamePath = path.join(eaRoot, dir.name);
      const eaArt = EA_ART[dir.name] || {};

      let eaExe = null;
      try {
        const exes = fs.readdirSync(gamePath).filter(f =>
          f.endsWith('.exe') && !/unins|anticheat|setup|redist/i.test(f)
        );
        if (exes.length > 0) eaExe = path.join(gamePath, exes[0]);
      } catch {}

      games.push({
        name: dir.name, platform: 'ea', installed: true,
        compatibility: 'proton',
        art: eaArt.tile || null,
        heroBlur: null,
        hero: eaArt.hero || null,
        logo: null,
        launch: eaExe,
        exe: eaExe,
      });
    }
  }
  return games;
}

function detectBackupGames() {
  const games = [];
  const gamesDir = path.join(WINDOWS_MNT, 'Users', 'Alden Bernstein', 'Cross-Plat-Games', 'Games');
  if (!fs.existsSync(gamesDir)) return games;

  try {
    for (const dir of fs.readdirSync(gamesDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const gamePath = path.join(gamesDir, dir.name);
      const gameName = dir.name;

      let compatibility = 'proton';
      if (ONLINE_BLOCKED.has(gameName) || gameName.toLowerCase().includes('rocketleague')) {
        compatibility = 'online-blocked';
      }

      let mainExe = null;
      try {
        const files = fs.readdirSync(gamePath);
        for (const f of files) {
          if (f.endsWith('.exe') && !/unins|anticheat|crash|launcher\.exe/i.test(f)) {
            mainExe = path.join(gamePath, f);
            break;
          }
        }
      } catch {}

      // Try to find art from known sources
      let art = null;
      let hero = null;
      if (gameName.includes('Hogwarts')) {
        art = 'https://cdn.cloudflare.steamstatic.com/steam/apps/990080/library_600x900.jpg';
        hero = 'https://cdn.cloudflare.steamstatic.com/steam/apps/990080/library_hero.jpg';
      } else if (gameName.toLowerCase().includes('rocket')) {
        art = 'https://cdn.cloudflare.steamstatic.com/steam/apps/252950/library_600x900.jpg';
        hero = 'https://cdn.cloudflare.steamstatic.com/steam/apps/252950/library_hero.jpg';
      }

      games.push({
        name: gameName, platform: 'backup', installed: true,
        compatibility,
        art, hero, heroBlur: hero, logo: null,
        launch: mainExe,
        exe: mainExe,
      });
    }
  } catch {}
  return games;
}

// ===== POPULATE =====
const allGamesRaw = [...detectSteamGames(), ...detectEAGames(), ...detectBackupGames()];
// Deduplicate by name (keep first occurrence which has better data)
const seenNames = new Set();
const allGames = allGamesRaw.filter(g => {
  const key = g.name.toLowerCase().replace(/\s+/g, '');
  if (seenNames.has(key)) return false;
  seenNames.add(key);
  return true;
});

const $gamelist = $('#gamelist');
$gamelist.empty();
allGames.slice(0, 12).forEach((game, i) => {
  const classes = i === 0 ? 'game latest' : 'game';
  const $tile = $(`<div class="${classes}" id="game-${i}"></div>`);
  if (game.art) {
    $tile.css('background-image', `url('${(game.art + '').replace(/\\/g, '/')}')`);
  } else {
    const hue = (i * 47) % 360;
    $tile.css('background', `linear-gradient(135deg, hsl(${hue},40%,25%), hsl(${hue+60},30%,15%))`);
    $tile.html(`<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:14px;font-weight:600;padding:12px;text-align:center">${game.name}</span>`);
  }

  // Platform badge
  const badge = game.platform === 'steam' ? 'STEAM' : game.platform === 'ea' ? 'EA' : game.platform === 'backup' ? 'LIBRARY' : '';
  if (badge) $tile.append(`<div class="platform-badge">${badge}</div>`);

  // Compatibility badge
  if (game.compatibility === 'windows-only') {
    $tile.append(`<div class="compat-badge">REQUIRES WINDOWS</div>`);
    $tile.addClass('blocked');
  } else if (game.compatibility === 'online-blocked') {
    $tile.append(`<div class="compat-badge online-blocked">OFFLINE ONLY</div>`);
  }

  $tile.data('game', game);
  $gamelist.append($tile);
});

// Featured tile bg
if (allGames.length > 0) {
  const fa = allGames[Math.min(3, allGames.length - 1)].art;
  if (fa) document.getElementById('util-ea-bg').style.backgroundImage = `url('${(fa+'').replace(/\\/g, '/')}')`;
}

// ===== CUSTOM ZONE NAVIGATION =====
const zones = ['games', 'utilities'];
let currentZone = 'games';
let currentIndex = 0;
let shutdownOpen = false;
let shutdownIndex = 0;
let mygamesOpen = false;

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
  if (mygamesOpen) { return; }
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
  hasMovedOnce = true;
  updateSelection();
}

setTimeout(() => updateSelection(), 100);

// ===== GAME MUSIC ON HOVER =====
const GAME_MUSIC = {};
const musicDir = path.join(__dirname, '..', 'cache', 'music');

// Auto-discover music by scanning the cache/music directory
try {
  for (const subdir of fs.readdirSync(musicDir, { withFileTypes: true })) {
    if (!subdir.isDirectory()) continue;
    const dirPath = path.join(musicDir, subdir.name);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.mp3') || f.endsWith('.ogg'));
    if (files.length > 0) {
      GAME_MUSIC[subdir.name] = files.map(f => path.join(dirPath, f));
    }
  }
} catch {}

let currentAudio = null;
let currentMusicKey = null;
let musicFadeTimer = null;
let musicDelayTimer = null;
let musicTrackIndex = 0;

const MUSIC_START_OFFSET = {
  '1091500': 18,  // Cyberpunk — skip 18s intro
};

function playGameMusic(game) {
  if (!hasMovedOnce) return;

  const key = game ? (game.appId || game.name?.toLowerCase().replace(/\s+/g, '') || game.platform) : null;
  let musicKey = null;
  if (key && GAME_MUSIC[key]) musicKey = key;
  else if (game && game.platform === 'ea') musicKey = GAME_MUSIC['pvz'] ? 'pvz' : null;
  else if (game && game.platform === 'epic' && game.name === 'Rocket League') musicKey = GAME_MUSIC['rocketleague'] ? 'rocketleague' : null;
  else if (game && game.platform === 'backup' && game.name?.includes('Rocket')) musicKey = GAME_MUSIC['rocketleague'] ? 'rocketleague' : null;

  if (musicKey === currentMusicKey) return;

  clearTimeout(musicDelayTimer);
  clearInterval(musicFadeTimer);

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
  const offset = MUSIC_START_OFFSET[currentMusicKey] || 0;
  if (offset > 0) currentAudio.currentTime = offset;
  currentAudio.play().catch(() => {});

  musicFadeTimer = setInterval(() => {
    if (currentAudio && currentAudio.volume < 0.3) {
      currentAudio.volume = Math.min(0.3, currentAudio.volume + 0.01);
    } else {
      clearInterval(musicFadeTimer);
    }
  }, 60);

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
  if (btn === 'DPAD_LEFT')  { navigate('left'); playNavSound(); }
  if (btn === 'DPAD_RIGHT') { navigate('right'); playNavSound(); }
  if (btn === 'DPAD_UP')    { navigate('up'); playNavSound(); }
  if (btn === 'DPAD_DOWN')  { navigate('down'); playNavSound(); }
  if (btn === 'FACE_1') handleA();
  if (btn === 'FACE_2') handleB();
  if (btn === 'START') handleStartMenu();
}, false);

window.addEventListener('gc.analog.start', function(event) {
  const pos = event.detail.position;
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
  if (mygamesOpen) { return; }
  launchSelected();
}

// ===== GAME CONTEXT MENU =====
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

  if (game.installed) {
    $opts.append(`<div class="context-option selected" data-action="launch">Launch game</div>`);
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

  if (action === 'launch' && game) {
    doLaunchGame(game);
  } else if (action === 'store' && game && game.appId) {
    ipcRenderer.send('launch-uri', `steam://store/${game.appId}`);
  }
  closeContextMenu();
}

function handleB() {
  if (shutdownOpen) { closeShutdownOverlay(); return; }
  if (contextMenuOpen) { closeContextMenu(); return; }
  if (mygamesOpen) { closeMygamesOverlay(); return; }
  // B on main screen: hide Patatin
  ipcRenderer.send('hide-window');
}

function showLoadingOverlay(game) {
  const $overlay = $('#loading-overlay');
  const $bg = $('#loading-bg');
  const $logo = $('#loading-logo');
  const $title = $('#loading-title');

  const heroSrc = (game.heroBlur || game.hero || game.art || '').replace(/\\/g, '/');
  if (heroSrc) { $bg.attr('src', heroSrc).show(); } else { $bg.hide(); }

  const logoSrc = (game.logo || '').replace(/\\/g, '/');
  if (logoSrc) { $logo.attr('src', logoSrc).show(); } else { $logo.hide(); }

  $title.text(game.name || 'Loading...');
  $overlay.css('display', 'flex');
}

function hideLoadingOverlay() {
  $('#loading-overlay').css('display', 'none');
}

function doLaunchGame(game) {
  // Check compatibility
  if (game.compatibility === 'windows-only') {
    notify('', `${game.name} requires Windows (anti-cheat not supported on Linux)`);
    return;
  }

  showLoadingOverlay(game);

  if (game.platform === 'steam' && game.appId) {
    ipcRenderer.send('launch-uri', `steam://rungameid/${game.appId}`);
  } else if (game.exe) {
    ipcRenderer.send('launch-exe', game.exe);
  } else if (game.launch) {
    ipcRenderer.send('launch-uri', game.launch);
  }
}

function launchSelected() {
  const items = getZoneElements(currentZone);
  const $el = $(items[currentIndex]);
  const game = $el.data('game');
  if (game) {
    doLaunchGame(game);
    return;
  }
  // Utility tile
  const id = $el.attr('id');
  if (id === 'util-mygames') openMygamesOverlay();
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
  else if (action === 'restart') ipcRenderer.send('system-reboot');
  else if (action === 'shutdown') ipcRenderer.send('system-shutdown');
  closeShutdownOverlay();
}

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
  allGames.forEach((game) => {
    const $tile = $(`<div class="mg-tile"></div>`);
    if (game.art) $tile.css('background-image', `url('${(game.art+'').replace(/\\/g, '/')}')`);
    $tile.append(`<div class="mg-name">${game.name}</div>`);
    if (game.compatibility === 'windows-only') {
      $tile.append(`<div class="mg-blocked">REQUIRES WINDOWS</div>`);
      $tile.addClass('blocked');
    }
    $tile.data('game', game);
    $grid.append($tile);
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

// ===== MUTE WHEN GAME RUNNING OR PATATIN HIDDEN =====
ipcRenderer.on('game-launched', () => {
  if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
  currentMusicKey = null;
});

ipcRenderer.on('game-ready', () => {
  hideLoadingOverlay();
});

ipcRenderer.on('patatin-hidden', () => {
  if (currentAudio) { currentAudio.pause(); }
});

ipcRenderer.on('patatin-shown', () => {
  hideLoadingOverlay();
  const items = getZoneElements(currentZone);
  if (currentZone === 'games' && items[currentIndex]) {
    const game = $(items[currentIndex]).data('game');
    currentMusicKey = null;
    playGameMusic(game);
  }
});

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
