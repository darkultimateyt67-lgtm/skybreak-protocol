import './engine/FastMatrix.js';
import { Game } from './engine/Game.js';
import { Loading } from './ui/Loading.js';

// The loading screen is already up from index.html. Let it paint the step
// before init() blocks the thread building the menu's world, then clear it.
(async () => {
  Loading.step('Building the world', 0.08, 0.92, 5000);
  await Loading.frame();

  const game = new Game(document.getElementById('game'));
  game.init();

  // Exposed for the developer console and automated smoke tests.
  window.GAME = game;

  Loading.step('Preparing graphics', 0.93, 1, 2000);
  await Loading.frame();
  await game.warmShaders();
  Loading.step('Ready', 1);
  await Loading.frame();
  Loading.hide();
})();
