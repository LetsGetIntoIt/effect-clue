import { createServer } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import {
    DEFAULT_DEV_PORT,
    findAvailablePort,
    parsePort,
} from "./dev-port.mjs";

const openServers = [];

afterEach(async () => {
    await Promise.all(
        openServers.splice(0).map(
            (server) =>
                new Promise((resolve, reject) => {
                    server.close((error) =>
                        error === undefined ? resolve() : reject(error),
                    );
                }),
        ),
    );
});

const occupyPort = async () =>
    new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen({ port: 0 }, () => {
            openServers.push(server);
            const address = server.address();
            if (address === null || typeof address === "string") {
                reject(new Error("Expected TCP server address"));
                return;
            }
            resolve(address.port);
        });
    });

describe("dev port selection", () => {
    test("defaults to the standard Next.js dev port", () => {
        expect(parsePort(undefined)).toBe(DEFAULT_DEV_PORT);
        expect(parsePort("")).toBe(DEFAULT_DEV_PORT);
    });

    test("uses the supplied PORT as the starting port", () => {
        expect(parsePort("4000")).toBe(4000);
    });

    test("rejects invalid PORT values", () => {
        expect(() => parsePort("abc")).toThrow("Invalid PORT value");
        expect(() => parsePort("70000")).toThrow("Invalid PORT value");
    });

    test("skips an occupied starting port", async () => {
        const occupiedPort = await occupyPort();

        await expect(
            findAvailablePort({
                startPort: occupiedPort,
                maxPort: occupiedPort + 10,
            }),
        ).resolves.toBeGreaterThan(occupiedPort);
    });
});
