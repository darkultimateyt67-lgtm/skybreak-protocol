import { Game } from './engine/Game.js';

const game = new Game(document.getElementById('game'));
game.init();

// Exposed for the developer console and automated smoke tests.
window.GAME = game;
