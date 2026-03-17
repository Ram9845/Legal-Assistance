const { spawn } = require("child_process");
const path = require("path");

const root = __dirname;

const services = [
  {
    name: "ml-fastapi",
    cwd: path.join(root, "ml-fastapi"),
    command: "python",
    args: ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"],
  },
  {
    name: "backend-node",
    cwd: path.join(root, "backend-node"),
    command: "node",
    args: ["apiServer.js"],
  },
  {
    name: "frontend",
    cwd: path.join(root, "frontend"),
    command: "node",
    args: ["webServer.js"],
  },
];

const children = [];

function pipeWithPrefix(stream, prefix) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        console.log(`[${prefix}] ${line}`);
      }
    }
  });
}

function startService(service) {
  const commandString = [service.command, ...service.args].join(" ");
  const child = spawn(commandString, {
    cwd: service.cwd,
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  });

  pipeWithPrefix(child.stdout, service.name);
  pipeWithPrefix(child.stderr, `${service.name}:err`);

  child.on("exit", (code) => {
    console.log(`[${service.name}] exited with code ${code}`);
  });

  child.on("error", (error) => {
    console.error(`[${service.name}:err] failed to start: ${error.message}`);
  });

  children.push(child);
}

for (const service of services) {
  startService(service);
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  console.log("Stopping all services...");
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

console.log("Services starting...");
console.log("Frontend: http://localhost:3000");
console.log("Backend:  http://localhost:5000");
console.log("ML API:   http://localhost:8000");
