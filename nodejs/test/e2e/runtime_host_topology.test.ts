/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from "node:child_process";
import { once } from "node:events";
import { readlink } from "node:fs/promises";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { assertListenerClosed, assertRuntimeListener } from "./harness/runtimeHostTopology.js";

describe.skipIf(process.platform !== "linux")("Runtime host /proc evidence", () => {
    it.each(["copilotd", "copilotd-test", "copilot-runtime"])(
        "rejects a %s descendant independently of the advertised PID",
        async (argv0) => {
            const server = createServer();
            await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
            const child = spawn(
                process.execPath,
                ["-e", "process.send('ready'); setInterval(() => {}, 1000)"],
                { argv0, stdio: ["ignore", "ignore", "ignore", "ipc"] }
            );
            try {
                await once(child, "message");
                const address = server.address();
                if (!address || typeof address === "string") throw new Error("No test listener");
                const runtimePath = await readlink(`/proc/${process.pid}/exe`);
                await expect(
                    assertRuntimeListener({ url: `ws://127.0.0.1:${address.port}` }, process.pid, {
                        runtimePath,
                        providerPath: runtimePath,
                        embedded: true,
                    })
                ).rejects.toThrow("No host or second runtime child");
            } finally {
                const exited = once(child, "exit");
                child.kill();
                await exited;
                await new Promise<void>((resolve, reject) =>
                    server.close((error) => (error ? reject(error) : resolve()))
                );
            }
        }
    );

    it("requires the advertised listener to be an open socket owned by the identified process", async () => {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No test listener");
        const host = { url: `ws://127.0.0.1:${address.port}` };
        // Unit-test the OS probe with Node's own executable mapping, not a runtime substitute.
        const runtimePath = await readlink(`/proc/${process.pid}/exe`);
        const artifacts = { runtimePath, providerPath: runtimePath };
        try {
            await expect(
                assertRuntimeListener(host, process.pid, artifacts)
            ).resolves.toBeUndefined();
            await expect(
                assertRuntimeListener(host, process.pid, {
                    ...artifacts,
                    providerPath: "/missing-source-provider",
                })
            ).rejects.toThrow("source-built provider");
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        }
        await assertListenerClosed(host, process.pid);
        await expect(assertRuntimeListener(host, process.pid, artifacts)).rejects.toThrow(
            "own the listening TCP socket"
        );
    });

    it("rejects a different process even when it maps the expected executable and provider", async () => {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const child = spawn(
            process.execPath,
            ["-e", "process.send('ready'); setInterval(() => {}, 1000)"],
            { stdio: ["ignore", "ignore", "ignore", "ipc"] }
        );
        try {
            await once(child, "message");
            const address = server.address();
            if (!address || typeof address === "string") throw new Error("No test listener");
            const runtimePath = await readlink(`/proc/${child.pid}/exe`);
            await expect(
                assertRuntimeListener({ url: `ws://127.0.0.1:${address.port}` }, child.pid!, {
                    runtimePath,
                    providerPath: runtimePath,
                })
            ).rejects.toThrow("own the listening TCP socket");
        } finally {
            const exited = once(child, "exit");
            child.kill();
            await exited;
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        }
    });
});
