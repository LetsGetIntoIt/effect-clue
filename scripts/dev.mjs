#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
    DEFAULT_DEV_PORT,
    findAvailablePort,
    parsePort,
} from "./dev-port.mjs";

const startPort = parsePort(process.env.PORT, DEFAULT_DEV_PORT);
const port = await findAvailablePort({ startPort });

if (port !== startPort) {
    console.log(
        `Port ${startPort} is busy; starting Next.js on port ${port}.`,
    );
}

const child = spawn("next", ["dev", "--port", String(port)], {
    env: {
        ...process.env,
        PORT: String(port),
    },
    stdio: "inherit",
});

child.on("exit", (code, signal) => {
    if (signal !== null) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});
