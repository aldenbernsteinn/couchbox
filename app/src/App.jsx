import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGamepad } from './hooks/useGamepad';

// Utility tiles — matches Xbox "My games & apps", "MS Store", etc.
const UTILITY_TILES = [
  { id: 'my-games', label: 'My games\n& apps', icon: '🎮', size: 'size-sq', color: 'c-green', type: 'uri', uri: 'steam://open/bigpicture' },
  { id: 'ms-store', label: 'Microsoft\nStore', icon: '🏪', size: 'size-sq', color: 'c-dark', type: 'xbox-store' },
  { id: 'favorites', label: 'Favorites', sublabel: 'YouTube TV coming soon', icon: '❤️', size: 'size-wide', color: 'c-gray', type: 'placeholder', disabled: true },
  { id: 'trending', label: 'Trending: CouchBox', sublabel: 'FEATURED', icon: null, size: 'size-featured', color: 'c-teal', type: 'placeholder', featured: true },
];

function App() {
  const [games, setGames] = useState({ steam: [], ea: [], xbox: [] });
  const [loading, setLoading] = useState(true);
  const [focusZone, setFocusZone] = useState('games');
  const [focusCol, setFocusCol] = useState(0);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [clock, setClock] = useState('');
  const gameRowRef = useRef(null);

  // Clock update
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load games
  useEffect(() => {
    async function load() {
      if (window.couchbox) {
        const detected = await window.couchbox.getGames();
        setGames(detected);
      } else {
        // Dev mode — mock with real Steam CDN art
        setGames({
          steam: [
            { id: 's1', name: 'Halo Infinite', appId: '1240440', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1240440/library_600x900.jpg' } },
            { id: 's2', name: 'Forza Horizon 5', appId: '1551360', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1551360/library_600x900.jpg' } },
            { id: 's3', name: 'Counter-Strike 2', appId: '730', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_600x900.jpg' } },
            { id: 's4', name: 'Portal 2', appId: '620', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_600x900.jpg' } },
            { id: 's5', name: 'Left 4 Dead 2', appId: '550', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/550/library_600x900.jpg' } },
            { id: 's6', name: 'Dota 2', appId: '570', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/570/library_600x900.jpg' } },
            { id: 's7', name: 'Team Fortress 2', appId: '440', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/440/library_600x900.jpg' } },
            { id: 's8', name: 'Elden Ring', appId: '1245620', platform: 'steam', art: { capsule: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_600x900.jpg' } },
          ],
          ea: [],
          xbox: [],
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  const allGames = [...games.steam, ...games.ea, ...games.xbox];

  const zones = ['games', 'utilities'];
  const getZoneItems = (zone) => {
    if (zone === 'games') return allGames;
    if (zone === 'utilities') return UTILITY_TILES;
    return [];
  };

  const handleGamepadInput = useCallback((action) => {
    if (youtubeOpen) {
      if (action === 'B') {
        setYoutubeOpen(false);
        window.couchbox?.closeYouTube();
      }
      return;
    }

    const zoneIdx = zones.indexOf(focusZone);
    const items = getZoneItems(focusZone);

    switch (action) {
      case 'UP':
        if (zoneIdx > 0) {
          const newZone = zones[zoneIdx - 1];
          setFocusZone(newZone);
          setFocusCol(Math.min(focusCol, getZoneItems(newZone).length - 1));
        }
        break;
      case 'DOWN':
        if (zoneIdx < zones.length - 1) {
          const newZone = zones[zoneIdx + 1];
          setFocusZone(newZone);
          setFocusCol(Math.min(focusCol, getZoneItems(newZone).length - 1));
        }
        break;
      case 'LEFT':
        setFocusCol(Math.max(0, focusCol - 1));
        break;
      case 'RIGHT':
        setFocusCol(Math.min(items.length - 1, focusCol + 1));
        break;
      case 'A':
        handleSelect();
        break;
      case 'B':
        setFocusZone('games');
        setFocusCol(0);
        break;
      default:
        break;
    }
  }, [focusZone, focusCol, youtubeOpen, allGames]);

  // Auto-scroll game row
  useEffect(() => {
    if (focusZone === 'games' && gameRowRef.current) {
      const tile = gameRowRef.current.children[focusCol];
      if (tile) tile.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [focusZone, focusCol]);

  const handleSelect = () => {
    if (focusZone === 'games') {
      const game = allGames[focusCol];
      if (game) launchItem(game);
    } else if (focusZone === 'utilities') {
      const tile = UTILITY_TILES[focusCol];
      if (tile && !tile.disabled) launchItem(tile);
    }
  };

  const launchItem = (item) => {
    if (item.disabled || item.type === 'placeholder') return;
    if (item.type === 'youtube') {
      setYoutubeOpen(true);
      window.couchbox?.launchApp({ type: 'youtube' });
      return;
    }
    if (item.platform === 'steam') {
      window.couchbox?.launchApp({ type: 'uri', uri: item.launchUri || `steam://rungameid/${item.appId}` });
      return;
    }
    if (item.type === 'uri') {
      window.couchbox?.launchApp({ type: 'uri', uri: item.uri });
      return;
    }
    if (item.type === 'xbox-store') {
      window.couchbox?.launchApp({ type: 'xbox-store' });
      return;
    }
    if (item.exe) {
      window.couchbox?.launchApp({ type: 'exe', exe: item.exe });
    }
  };

  useGamepad(handleGamepadInput);

  // Keyboard for testing
  useEffect(() => {
    const handler = (e) => {
      const keyMap = {
        ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
        Enter: 'A', Escape: 'B', ' ': 'A',
      };
      const action = keyMap[e.key];
      if (action) { e.preventDefault(); handleGamepadInput(action); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleGamepadInput]);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <span className="loading-text">COUCHBOX</span>
      </div>
    );
  }

  const platformLabel = (game) => {
    if (game.platform === 'steam') return 'STEAM';
    if (game.platform === 'ea') return 'EA';
    if (game.platform === 'xbox') return 'XBOX';
    return null;
  };

  return (
    <div className="dashboard">
      {/* ===== TOP BAR ===== */}
      <div className="top-bar">
        <div className="top-bar-left">
          <div className="profile-icon">CB</div>
          <div className="profile-info">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="profile-name">CouchBox</span>
              <span className="profile-tag">READY</span>
            </div>
            <span className="profile-sub">
              🎮 {allGames.length} games
            </span>
          </div>
        </div>
        <div className="top-bar-right">
          <div className={`search-box ${focusZone === 'search' ? 'focused' : ''}`}>
            <span>🔍</span>
            <span>Search</span>
          </div>
          <div className="clock-area">
            <span className="icons">🔇 📷</span>
            <span>{clock}</span>
          </div>
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div className="main-content">
        {/* Jump back in */}
        <div className="games-section">
          <div className="section-title">Jump back in</div>
          <div className="game-row" ref={gameRowRef}>
            {allGames.map((game, i) => {
              const badge = platformLabel(game);
              return (
                <div
                  key={game.id}
                  className={`game-tile-wrap ${focusZone === 'games' && focusCol === i ? 'show-name' : ''}`}
                >
                  <div className={`game-tile ${focusZone === 'games' && focusCol === i ? 'focused' : ''}`}>
                    {(game.art?.capsule || game.art?.header) ? (
                      <img src={game.art.capsule || game.art.header} alt={game.name} loading="lazy" />
                    ) : (
                      <div
                        className="no-art"
                        style={{ background: `linear-gradient(135deg, hsl(${(i * 47) % 360}, 40%, 25%), hsl(${(i * 47 + 60) % 360}, 30%, 15%))` }}
                      >
                        {game.name}
                      </div>
                    )}
                    {badge && <div className="platform-badge">{badge}</div>}
                  </div>
                  <div className="game-tile-name">{game.name}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Utility Tiles */}
        <div className="utility-section">
          <div className="utility-row">
            {UTILITY_TILES.map((tile, i) => (
              <div
                key={tile.id}
                className={`utility-tile ${tile.size} ${tile.color} ${tile.disabled ? 'disabled' : ''} ${focusZone === 'utilities' && focusCol === i ? 'focused' : ''}`}
              >
                {tile.featured ? (
                  <>
                    <div className="featured-content">
                      <span className="featured-tag">{tile.sublabel}</span>
                      <span className="utility-label">{tile.label}</span>
                    </div>
                  </>
                ) : (
                  <>
                    {tile.icon && <span className="utility-icon">{tile.icon}</span>}
                    <div className="utility-text">
                      <span className="utility-label">
                        {tile.label.split('\n').map((line, j) => (
                          <React.Fragment key={j}>
                            {line}
                            {j < tile.label.split('\n').length - 1 && <br />}
                          </React.Fragment>
                        ))}
                      </span>
                      {tile.sublabel && <span className="utility-sublabel">{tile.sublabel}</span>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom scroll label */}
        <div className="bottom-label">Recently added to CouchBox</div>
      </div>

      {/* ===== BUTTON HINTS ===== */}
      <div className="button-hints">
        <div className="hint">
          <span className="glyph">☰</span> More options
        </div>
        <div className="hint">
          <span className="btn-circle btn-y">Y</span> Add to Play Later
        </div>
        <div className="hint">
          <span className="glyph">🔍</span> Search
        </div>
      </div>

      {/* YouTube TV Overlay */}
      {youtubeOpen && (
        <div className="youtube-overlay">
          <div className="youtube-hint">
            Press <strong>B</strong> to close YouTube TV
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
