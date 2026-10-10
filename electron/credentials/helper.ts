// Git credential helper, run by git as `<electron> helper.js <get|store|erase>` with ELECTRON_RUN_AS_NODE=1.
// It relays the request to the main process over the socket in LUMIERE_CRED_SOCKET (see broker.ts) and
// prints the answer. No Electron APIs here. Any failure prints nothing, so git just moves on.
import net from "node:net";

const op = process.argv[2] ?? "";
const socketPath = process.env.LUMIERE_CRED_SOCKET;
const token = process.env.LUMIERE_CRED_TOKEN;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  const input = await readStdin();
  if (!socketPath || !token || !["get", "store", "erase"].includes(op)) return;
  const answer = await new Promise<string>((resolve) => {
    const sock = net.connect(socketPath);
    let data = "";
    sock.setEncoding("utf8");
    sock.on("connect", () =>
      sock.write(`${JSON.stringify({ token, op, input })}\n`),
    );
    sock.on("data", (d: string) => (data += d));
    sock.on("end", () => {
      try {
        resolve(String(JSON.parse(data).output ?? ""));
      } catch {
        resolve("");
      }
    });
    sock.on("error", () => resolve(""));
  });
  process.stdout.write(answer);
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
