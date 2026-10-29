import { defineConfig, type Plugin } from 'vite';

/** Runs the multiplayer game server (server/server.ts) and the leaderboard API inside the dev server, on the same port. */
function gameServer(): Plugin {
  return {
    name: 'nightfall-game-server',
    async configureServer(server) {
      const { attachGameServer, handleApi } = await server.ssrLoadModule('/server/server.ts');
      if (server.httpServer) attachGameServer(server.httpServer);
      server.middlewares.use((req, res, next) => { if (!handleApi(req, res)) next(); });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [gameServer()],
  // host: true listens on the LAN too, so friends can join with your Network address.
  // data/ holds the leaderboard file, which the server rewrites as runs end.
  server: { port: 3000, open: false, host: true, watch: { ignored: ['**/data/**'] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000, // Phaser alone is ~1.2 MB
  },
});
