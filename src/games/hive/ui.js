export const markup = `
        <div class="speech-layer garden-only" id="speech" aria-hidden="true"></div>
        <div class="bumble-alert garden-only" id="bumble-alert" hidden><div class="alert-banner" role="alert"><strong>⚠ ALERT</strong><span>BUMBLEBEE INCOMING</span><em id="alert-count">4</em></div></div>
        <div class="bumble-marker garden-only" id="bumble-marker" hidden aria-hidden="true"><i></i><span>🐝</span></div>
        <div class="reticle garden-only" id="reticle" hidden aria-hidden="true"></div>
        <div class="arena-top garden-only">
          <div class="world-title"><span class="live-dot"></span> HONEY RETRIEVAL<small>ROUND <span id="round">01</span></small></div>
          <div class="mission-status"><div><span>HIVE</span><strong id="honey">0</strong><span>/ 300</span><span id="percent">0%</span></div><div class="progress-track"><i id="honey-progress"></i></div></div>
          <div class="round-clock"><span id="phase">READY</span><strong id="timer">3:00</strong></div>
          <div class="arena-actions"><button id="view" title="Switch to bee view (V)" aria-label="Switch to bee view" aria-pressed="false">👁 <span>Bee view</span></button><button id="sound" title="Toggle sound" aria-label="Disable sound" aria-pressed="true">♪ <span>Sound on</span></button><button id="fullscreen" title="Fullscreen (F)" aria-label="Toggle fullscreen">⛶</button><button id="pause" title="Pause game" aria-label="Pause game" disabled>Ⅱ</button></div>
        </div>
        <div class="scene-label garden-only" id="hive-label">HIVE<span>nectar drop-off</span></div>
        <div class="intro garden-only" id="intro"><div><h1>Collect. Return. Repeat.</h1><p>300 nectar. 3 minutes. You + 6 AI scouts. Fly high and low, and dodge the clumsy bumblebee.</p></div><button id="start" class="primary play-button" aria-label="Start flight" title="Start flight">▶</button></div>
        <div class="flight-hud garden-only" id="flight-hud" hidden><div><span>YOUR NECTAR</span><div id="bag" class="bag"></div></div><div class="boost"><span id="boost-label">BOOST READY</span><div><i id="boost-meter"></i></div></div><div class="altitude" title="Altitude"><span>ALT</span><div class="alt-track"><i id="alt-marker"></i></div><strong id="alt">2.0</strong></div><button id="home" title="Point to hive">⌂ <span>Return to hive</span></button></div>
        <div class="mobile-controls garden-only" id="touch-controls"><div class="dpad"><button data-key="KeyW" aria-label="Fly forward">↑</button><button data-key="KeyA" aria-label="Fly left">←</button><button data-key="KeyS" aria-label="Fly backward">↓</button><button data-key="KeyD" aria-label="Fly right">→</button></div><div><button data-key="Space" aria-label="Fly up">▲</button><button data-key="KeyC" aria-label="Fly down">▼</button><button data-key="ShiftLeft">Boost</button></div></div>
        `;
