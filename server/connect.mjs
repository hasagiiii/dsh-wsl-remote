// Run on a Linux host by launch.sh `attach`: join this process's stdio to a
// resident agent's Unix socket (dsh-wsl-remote installed in a dsh that runs
// on its own), so the Windows Host talks to that dsh through `wsl.exe` or
// `ssh` exactly as it does to one it started. Exits when either side ends.
//   node connect.mjs <socket path>
// Prints the mux marker first (an SSH login banner may precede it). Exit 3:
// nothing answers on the socket (Windows then starts its own dsh).
import { createConnection } from 'node:net';

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: connect.mjs <socket>\n');
  process.exit(2);
}
const socket = createConnection(path);
socket.once('error', (error) => {
  process.stderr.write(`wsl-remote attach: ${error.code ?? error.message}\n`);
  process.exit(3);
});
socket.once('connect', () => {
  socket.removeAllListeners('error');
  socket.on('error', () => process.exit(1));
  process.stdout.write('\n__DSH_REMOTE_MUX_V1__\n');
  socket.pipe(process.stdout);
  process.stdin.pipe(socket);
  process.stdin.on('end', () => socket.end());
  socket.on('close', () => process.exit(0));
});
