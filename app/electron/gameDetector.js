const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Parse Valve's VDF format (simple key-value pairs)
function parseVDF(content) {
  const result = {};
  const lines = content.split('\n');
  let currentKey = null;
  for (const line of lines) {
    const kvMatch = line.match(/^\s*"([^"]+)"\s+"([^"]*)"$/);
    if (kvMatch) {
      result[kvMatch[1]] = kvMatch[2];
    }
  }
  return result;
}

// Detect Steam games from local manifest files
function detectSteamGames() {
  const games = [];
  const steamPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ];

  let steamRoot = null;
  for (const p of steamPaths) {
    if (fs.existsSync(path.join(p, 'steam.exe'))) {
      steamRoot = p;
      break;
    }
  }
  if (!steamRoot) return games;

  // Find all library folders
  const libraryFolders = [path.join(steamRoot, 'steamapps')];
  const libraryVdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(libraryVdf)) {
    const content = fs.readFileSync(libraryVdf, 'utf8');
    // Match "path" entries
    const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/g);
    for (const m of pathMatches) {
      const libPath = m[1].replace(/\\\\/g, '\\');
      const appsDir = path.join(libPath, 'steamapps');
      if (fs.existsSync(appsDir) && !libraryFolders.includes(appsDir)) {
        libraryFolders.push(appsDir);
      }
    }
  }

  // Scan each library for appmanifest files
  for (const appsDir of libraryFolders) {
    let files;
    try {
      files = fs.readdirSync(appsDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;

      const appId = file.replace('appmanifest_', '').replace('.acf', '');
      const content = fs.readFileSync(path.join(appsDir, file), 'utf8');
      const manifest = parseVDF(content);

      if (!manifest.name || manifest.name === 'Steamworks Common Redistributables') continue;

      games.push({
        id: `steam_${appId}`,
        name: manifest.name,
        platform: 'steam',
        appId,
        launchUri: `steam://rungameid/${appId}`,
        art: {
          header: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
          hero: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
          capsule: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
          logo: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`,
        },
        // Also check local cache
        localArt: path.join(steamRoot, 'appcache', 'librarycache', `${appId}_header.jpg`),
      });
    }
  }

  return games;
}

// Detect EA games from install directory
function detectEAGames() {
  const games = [];
  const eaPaths = [
    'C:\\Program Files\\EA Games',
    'C:\\Program Files (x86)\\EA Games',
    'C:\\Program Files\\Electronic Arts',
  ];

  for (const eaRoot of eaPaths) {
    if (!fs.existsSync(eaRoot)) continue;

    const dirs = fs.readdirSync(eaRoot, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;

      const gamePath = path.join(eaRoot, dir.name);
      // Find main exe
      let mainExe = null;
      let iconPath = null;

      // Look for icon
      const iconCandidates = [
        path.join(gamePath, '__Installer', 'icon.ico'),
        path.join(gamePath, 'Support', 'icon.ico'),
        path.join(gamePath, '__Installer', 'icon.png'),
      ];
      for (const ic of iconCandidates) {
        if (fs.existsSync(ic)) { iconPath = ic; break; }
      }

      // Find exe files in root of game dir
      try {
        const rootFiles = fs.readdirSync(gamePath);
        for (const f of rootFiles) {
          if (f.endsWith('.exe') && !f.toLowerCase().includes('unins')) {
            mainExe = path.join(gamePath, f);
            break;
          }
        }
      } catch { /* skip */ }

      games.push({
        id: `ea_${dir.name.replace(/\s+/g, '_').toLowerCase()}`,
        name: dir.name,
        platform: 'ea',
        exe: mainExe,
        art: {
          icon: iconPath,
        },
      });
    }
  }

  return games;
}

// Detect Xbox / Microsoft Store games via PowerShell
function detectXboxGames() {
  return new Promise((resolve) => {
    const ps = `
      Get-AppxPackage | Where-Object {
        $_.SignatureKind -eq 'Store' -and
        $_.IsFramework -eq $false -and
        $_.Name -notmatch 'Microsoft\\.|Windows\\.|MicrosoftWindows'
      } | ForEach-Object {
        $manifest = Join-Path $_.InstallLocation 'AppxManifest.xml'
        $logo = ''
        if (Test-Path $manifest) {
          [xml]$xml = Get-Content $manifest
          $ns = @{x='http://schemas.microsoft.com/appx/manifest/foundation/windows10'}
          $logoNode = $xml.SelectSingleNode('//x:Properties/x:Logo', $ns)
          if ($logoNode) { $logo = Join-Path $_.InstallLocation $logoNode.InnerText }
        }
        [PSCustomObject]@{
          Name = $_.Name
          DisplayName = (Get-AppxPackageManifest $_).Package.Properties.DisplayName
          FamilyName = $_.PackageFamilyName
          InstallLocation = $_.InstallLocation
          Logo = $logo
        }
      } | ConvertTo-Json -Depth 3
    `.replace(/\n/g, ' ');

    exec(`powershell -Command "${ps.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
      if (err) { resolve([]); return; }
      try {
        let parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) parsed = [parsed];
        const games = parsed
          .filter(p => p && p.DisplayName && !p.DisplayName.startsWith('ms-resource'))
          .map(p => ({
            id: `xbox_${p.Name}`,
            name: p.DisplayName,
            platform: 'xbox',
            familyName: p.FamilyName,
            launchUri: `shell:AppsFolder\\${p.FamilyName}!App`,
            art: {
              logo: p.Logo && fs.existsSync(p.Logo) ? p.Logo : null,
              // Check for larger tiles
              largeTile: findAppxArt(p.InstallLocation),
            },
          }));
        resolve(games);
      } catch {
        resolve([]);
      }
    });
  });
}

// Find the best art asset in an AppX package
function findAppxArt(installLocation) {
  if (!installLocation) return null;
  const assetsDir = path.join(installLocation, 'Assets');
  if (!fs.existsSync(assetsDir)) return null;

  // Prefer larger tiles
  const preferred = ['LargeTile', 'StoreLogo', 'Square310', 'Square150', 'Wide310'];
  try {
    const files = fs.readdirSync(assetsDir);
    for (const pref of preferred) {
      const match = files.find(f => f.includes(pref) && (f.endsWith('.png') || f.endsWith('.jpg')));
      if (match) return path.join(assetsDir, match);
    }
    // Fallback: any png
    const anyPng = files.find(f => f.endsWith('.png'));
    if (anyPng) return path.join(assetsDir, anyPng);
  } catch { /* skip */ }
  return null;
}

// Detect all games across all platforms
async function detectAllGames() {
  const steam = detectSteamGames();
  const ea = detectEAGames();
  const xbox = await detectXboxGames();
  return { steam, ea, xbox };
}

module.exports = { detectAllGames };
