/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { readFile, readdir, readlink } from "node:fs/promises";
import { connect } from "node:net";

type Listener = { url: string; token?: string };

/** Verify the listener's socket and loaded provider, independently of the RPC PID. */
export async function assertRuntimeListener(
    host: Listener,
    runtimePid: number,
    artifacts: { runtimePath: string; providerPath: string; bundled?: boolean; embedded?: boolean }
) {
    assert.equal(await readlink(`/proc/${runtimePid}/exe`), artifacts.runtimePath);
    const maps = await readFile(`/proc/${runtimePid}/maps`, "utf8");
    assert(maps.includes(artifacts.providerPath), "Runtime must load the source-built provider");
    const command = await readFile(`/proc/${runtimePid}/cmdline`, "utf8");
    assert(!command.includes("copilotd"), "No companion host process");
    if (host.token) assert(!command.includes(host.token), "Listener tokens must not enter argv");
    if (artifacts.bundled) {
        const environment = (await readFile(`/proc/${runtimePid}/environ`, "utf8")).split("\0");
        for (const name of ["COPILOT_RUNTIME_PROVIDER_LIB"]) {
            assert(
                !environment.some((entry) => entry.startsWith(`${name}=`)),
                `Candidate runtime must not receive the ${name} development override`
            );
        }
    }

    const descendants = [String(runtimePid)];
    while (descendants.length > 0) {
        const parent = descendants.pop()!;
        const children = new Set<string>();
        const tasks = await readdir(`/proc/${parent}/task`).catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
                return [];
            }
        );
        for (const tid of tasks) {
            const list = await readFile(`/proc/${parent}/task/${tid}/children`, "utf8").catch(
                (error: NodeJS.ErrnoException) => {
                    if (error.code !== "ENOENT") throw error;
                    return "";
                }
            );
            for (const pid of list.trim().split(/\s+/).filter(Boolean)) children.add(pid);
        }
        for (const pid of children) {
            try {
                const childCommand = await readFile(`/proc/${pid}/cmdline`, "utf8");
                assert(
                    !/copilotd|copilot-runtime/.test(childCommand),
                    "No host or second runtime child"
                );
                // Embedded CLI tools may also be Node processes; only one may load the provider.
                if (!artifacts.embedded) {
                    assert.notEqual(await readlink(`/proc/${pid}/exe`), artifacts.runtimePath);
                }
                const childMaps = await readFile(`/proc/${pid}/maps`, "utf8");
                assert(
                    !childMaps.includes(artifacts.providerPath),
                    "No second provider-loaded runtime"
                );
                descendants.push(pid);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
    }

    const port = Number(new URL(host.url).port);
    const sockets = new Set<string>();
    for (const fd of await readdir(`/proc/${runtimePid}/fd`)) {
        const target = await readlink(`/proc/${runtimePid}/fd/${fd}`).catch(
            (error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
                return "";
            }
        );
        const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
        if (inode) sockets.add(inode);
    }
    const tables = await Promise.all(
        ["tcp", "tcp6"].map((name) => readFile(`/proc/${runtimePid}/net/${name}`, "utf8"))
    );
    assert(
        tables.some((table) =>
            table
                .split("\n")
                .slice(1)
                .some((line) => {
                    const fields = line.trim().split(/\s+/);
                    return (
                        fields[3] === "0A" &&
                        parseInt(fields[1]?.split(":")[1] ?? "", 16) === port &&
                        sockets.has(fields[9])
                    );
                })
        ),
        "The runtime PID must own the listening TCP socket, not merely advertise its PID"
    );
}

export async function assertListenerClosed(host: Listener, runtimePid: number | false) {
    const url = new URL(host.url);
    const refusal = await new Promise<string | undefined>((resolve, reject) => {
        const socket = connect({
            host: url.hostname.replace(/^\[|\]$/g, ""),
            port: Number(url.port),
        });
        socket.setTimeout(5_000, () => {
            socket.destroy();
            reject(new Error("Timed out probing stopped listener"));
        });
        socket.once("connect", () => {
            socket.destroy();
            resolve(undefined);
        });
        socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code));
    });
    assert.equal(refusal, "ECONNREFUSED", "Listener must close, not merely reject authentication");
    if (runtimePid !== false) process.kill(runtimePid, 0);
}
