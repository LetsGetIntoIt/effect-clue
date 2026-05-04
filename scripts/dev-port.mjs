import { createServer } from "node:net";

export const DEFAULT_DEV_PORT = 3000;
export const MAX_PORT = 65535;

export const parsePort = (
    rawPort,
    fallback = DEFAULT_DEV_PORT,
) => {
    if (rawPort === undefined || rawPort.trim() === "") {
        return fallback;
    }
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
        throw new Error(`Invalid PORT value: ${rawPort}`);
    }
    return port;
};

const canListenOnPort = (port) =>
    new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.once("error", (error) => {
            if (error.code === "EADDRINUSE") {
                resolve(false);
                return;
            }
            reject(error);
        });
        server.listen({ port }, () => {
            server.close(() => resolve(true));
        });
    });

export const findAvailablePort = async ({
    startPort = DEFAULT_DEV_PORT,
    maxPort = MAX_PORT,
} = {}) => {
    for (let port = startPort; port <= maxPort; port += 1) {
        if (await canListenOnPort(port)) {
            return port;
        }
    }
    throw new Error(`No available port found from ${startPort} to ${maxPort}`);
};
