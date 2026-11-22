const childProcess = require("child_process");
const EventEmitter = require("events");
const fs = require("fs/promises");
const net = require("net");
const os = require("os");
const path = require("path");
//
// Port of the Remote Desktop service on a Windows VM.
const RDP_PORT = 3389;
//
// Session hysteresis. While credentials, certificate or a wrong password are being
// handled, the client may drop and reopen its connection: the session counts as
// started only after MIN_UP_MS of continuous connection, and as ended only after
// GRACE_MS without any. CONNECT_TIMEOUT_MS bounds the wait before the start only.
const MIN_UP_MS = 15000;
const GRACE_MS = 10000;
const CONNECT_TIMEOUT_MS = 180000;
//
// The relay listens on the IPv4 loopback, and the .rdp file names it the same way.
const RELAY_HOST = "127.0.0.1";
//
// Private folder of the .rdp files, under the system temporary directory.
const RDP_DIR_NAME = "8bitsapps-gcp-utils-rdp";
//
// Characters kept in a .rdp file name; anything else becomes "_".
const UNSAFE_FILE_CHARS = /[^A-Za-z0-9._-]/g;
//
// Hints for a system that has no client for .rdp files.
const CLIENT_HINTS = {
  darwin: "No app opens .rdp files: install Windows App from the Mac App Store.",
  win32: "Could not start the Remote Desktop client (mstsc).",
  linux: "No app opens .rdp files: install an RDP client that handles them, such as Remmina."
};
//
/**
 * Starts a local TCP relay in front of a port, counting the connections that go through it.
 * The relay is what tells when an RDP session opens and closes, on every system,
 * without lsof or netstat. Each client socket is paired with one towards the target:
 * both carry an error listener, since an unhandled ECONNRESET would end the tool, and
 * when either side errors or closes the other is destroyed, so a half-open socket never
 * keeps the count above zero. A pair leaves the count once only.
 * @param {number} targetPort - Local port to forward to, the one of the IAP tunnel.
 * @returns {Promise<EventEmitter>} The relay: port, activeCount(), close(), and "change" events carrying the active count.
 */
function startRelay(targetPort) {
  return new Promise((resolve, reject) => {
    const relay = new EventEmitter();
    const sockets = new Set();
    let active = 0;
    let listening = false;
    //
    const server = net.createServer(client => {
      const upstream = net.connect({ host: "localhost", port: targetPort });
      let closed = false;
      sockets.add(client);
      sockets.add(upstream);
      active += 1;
      relay.emit("change", active);
      //
      const closePair = () => {
        if (closed) {
          return;
        }
        closed = true;
        client.destroy();
        upstream.destroy();
        sockets.delete(client);
        sockets.delete(upstream);
        active -= 1;
        relay.emit("change", active);
      };
      client.on("error", closePair);
      upstream.on("error", closePair);
      client.on("close", closePair);
      upstream.on("close", closePair);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    //
    // Before listening an error rejects; afterwards it is ignored, rather than ending the tool.
    server.on("error", err => {
      if (!listening) {
        reject(err);
      }
    });
    server.listen(0, RELAY_HOST, () => {
      listening = true;
      relay.port = server.address().port;
      relay.activeCount = () => active;
      relay.close = () => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close();
      };
      resolve(relay);
    });
  });
}
//
/**
 * Watches the connections of a relay until the RDP session ends.
 * A state machine driven by the "change" events of the relay and three timers:
 * - on entry, an already aborted signal resolves at once, since it would never fire
 *   "abort" again; otherwise CONNECT_TIMEOUT starts, and MIN_UP too when the client
 *   connected before the watch began;
 * - waiting: a connection starts MIN_UP, losing every connection cancels it, and
 *   CONNECT_TIMEOUT resolves "timeout". When it expires while a connection is
 *   running MIN_UP, a login is in progress: MIN_UP decides, and losing that
 *   connection resolves "timeout" then;
 * - MIN_UP expires: the session has started, CONNECT_TIMEOUT is cancelled and onStarted runs;
 * - started: losing every connection starts GRACE, a new one cancels it, and GRACE resolves "ended";
 * - "abort", in any state, resolves "aborted".
 * Whatever the outcome, every timer is cancelled and every listener removed first.
 * @param {EventEmitter} relay - Relay from startRelay().
 * @param {{signal?: AbortSignal, onStarted?: function(): void, timings?: {minUpMs?: number, graceMs?: number, connectTimeoutMs?: number}}} [options] - Abort signal, start callback, and timings for tests.
 * @returns {Promise<string>} "ended", "timeout" or "aborted".
 */
function watchSession(relay, options = {}) {
  const { signal, onStarted } = options;
  const timings = { minUpMs: MIN_UP_MS, graceMs: GRACE_MS, connectTimeoutMs: CONNECT_TIMEOUT_MS, ...options.timings };
  return new Promise(resolve => {
    if (signal && signal.aborted) {
      resolve("aborted");
      return;
    }
    let done = false;
    let started = false;
    let expired = false;
    let minUpTimer = null;
    let graceTimer = null;
    let connectTimer = null;
    //
    const finish = outcome => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(minUpTimer);
      clearTimeout(graceTimer);
      clearTimeout(connectTimer);
      relay.removeListener("change", onChange);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve(outcome);
    };
    const onAbort = () => finish("aborted");
    const startMinUp = () => {
      if (minUpTimer !== null) {
        return;
      }
      minUpTimer = setTimeout(() => {
        minUpTimer = null;
        started = true;
        clearTimeout(connectTimer);
        connectTimer = null;
        if (onStarted) {
          onStarted();
        }
      }, timings.minUpMs);
    };
    //
    /**
     * Moves the state machine on a change of the active connection count.
     * @param {number} count - Connections now active.
     */
    function onChange(count) {
      if (!started) {
        if (count > 0) {
          startMinUp();
          return;
        }
        clearTimeout(minUpTimer);
        minUpTimer = null;
        if (expired) {
          finish("timeout");
        }
        return;
      }
      if (count > 0) {
        clearTimeout(graceTimer);
        graceTimer = null;
      } else if (graceTimer === null) {
        graceTimer = setTimeout(() => finish("ended"), timings.graceMs);
      }
    }
    //
    relay.on("change", onChange);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    connectTimer = setTimeout(() => {
      connectTimer = null;
      if (minUpTimer !== null) {
        expired = true;
        return;
      }
      finish("timeout");
    }, timings.connectTimeoutMs);
    if (relay.activeCount() > 0) {
      startMinUp();
    }
  });
}
//
/**
 * Returns the private folder of the .rdp files. On Linux the temporary directory is
 * the shared /tmp, where only the owner may remove an entry: the uid in the name keeps
 * one user's folder from blocking the others.
 * @returns {string} Absolute path under the system temporary directory.
 */
function getRdpDir() {
  const suffix = typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  return path.join(os.tmpdir(), `${RDP_DIR_NAME}${suffix}`);
}
//
/**
 * Creates the folder of the .rdp files, and makes sure only this user can write in it.
 * On Linux the temporary directory is the shared /tmp, so the path is predictable, and
 * the mode of mkdir applies only when the folder is created: a folder planted by another
 * user, or a symbolic link, would let them swap the file the RDP client opens. Such a
 * folder is refused; one of this user's with a wider mode is narrowed. Windows has no
 * POSIX owner and a per-user temporary directory, so only the link check applies there.
 * @param {string} dir - Folder from getRdpDir().
 * @returns {Promise<void>}
 * @throws {Error} If the folder is not a real one, or belongs to another user.
 */
async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory()) {
    throw new Error(`The .rdp folder "${dir}" is not a real folder: remove it and connect again.`);
  }
  if (typeof process.getuid !== "function") {
    return;
  }
  if (stat.uid !== process.getuid()) {
    throw new Error(`The .rdp folder "${dir}" belongs to another user, who could swap the files it holds: have it removed, then connect again.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    await fs.chmod(dir, 0o700);
  }
}
//
/**
 * Writes the .rdp file of a VM, one per VM and zone, overwritten at every connection.
 * It is never deleted, so the client can never find it gone before reading it; it
 * holds only the address and the user name. Lines end with CRLF, as mstsc writes them.
 * The old file is removed and the new one created exclusively ("wx"), so a symbolic
 * link left in its place is replaced, never followed.
 * @param {{instance: string, zone: string, address: string, username: string}} target - VM, its zone, the address to connect to, and an optional user name.
 * @returns {Promise<string>} Path of the .rdp file.
 */
async function writeRdpFile(target) {
  const dir = getRdpDir();
  await ensurePrivateDir(dir);
  const name = `${target.instance}-${target.zone}`.replace(UNSAFE_FILE_CHARS, "_");
  const file = path.join(dir, `${name}.rdp`);
  const lines = [`full address:s:${target.address}`];
  if (target.username) {
    lines.push(`username:s:${target.username}`);
  }
  await fs.rm(file, { force: true });
  await fs.writeFile(file, `${lines.join("\r\n")}\r\n`, { mode: 0o600, flag: "wx" });
  return file;
}
//
/**
 * Opens a .rdp file with the system's RDP client.
 * macOS uses the app associated with .rdp files through open, Linux through xdg-open:
 * both return once the app is launched, so their exit code tells whether one exists.
 * On Linux the client launched by xdg-open would inherit a piped stderr, and "close"
 * would wait for the client to exit: there stdio is ignored and "exit" decides. On
 * macOS the app is launched by LaunchServices, which inherits nothing, so stderr is
 * kept for the error message. Without a desktop environment, xdg-open itself may run
 * the client in the foreground: the watch then starts only once the session is over,
 * and the tunnel stays open until CONNECT_TIMEOUT or ESC.
 * On Windows mstsc is the client itself and lives as long as the session, so it is
 * detached and counts as launched once spawned.
 * @param {string} file - Path of the .rdp file.
 * @returns {Promise<void>}
 * @throws {Error} With a hint for the platform, if no client could be launched.
 */
function openRdpFile(file) {
  const hint = CLIENT_HINTS[process.platform] || CLIENT_HINTS.linux;
  if (process.platform === "win32") {
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn("mstsc", [file], { detached: true, stdio: "ignore" });
      let settled = false;
      child.on("spawn", () => {
        settled = true;
        child.unref();
        resolve();
      });
      child.on("error", err => {
        if (!settled) {
          settled = true;
          reject(new Error(`${hint} ${err.message}`));
        }
      });
    });
  }
  const isMac = process.platform === "darwin";
  const command = isMac ? "open" : "xdg-open";
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, [file], { stdio: ["ignore", "ignore", isMac ? "pipe" : "ignore"] });
    let stderr = "";
    let failed = false;
    if (isMac) {
      child.stderr.on("data", chunk => { stderr += chunk; });
    }
    child.on("error", err => {
      failed = true;
      reject(new Error(`${hint} (${command}: ${err.message})`));
    });
    child.on(isMac ? "close" : "exit", code => {
      if (failed) {
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${hint} (${stderr.trim() || `${command} exited with code ${code}`})`));
    });
  });
}
//
module.exports = {
  RDP_PORT,
  startRelay,
  watchSession,
  getRdpDir,
  writeRdpFile,
  openRdpFile
};
