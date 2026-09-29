/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { ActionType, type ChatState, type SessionState } from "@microsoft/agent-host-protocol-v09";
import { authenticateAhp, connectAhp, createAhpSession, streamedTurn } from "./ahpClient.js";

export type AhpTestCommand =
    | {
          op: "connect";
          url: string;
          token?: string;
          githubToken: string;
          clientId?: string;
      }
    | { op: "create"; clientId: string; workDir: string; clientTools?: boolean }
    | { op: "attach"; clientId: string; sessionId: string; clientTools?: boolean }
    | {
          op: "turn";
          clientId: string;
          sessionId: string;
          prompt: string;
          clientTools?: boolean;
      }
    | { op: "stopped"; clientId: string; url: string }
    | { op: "close"; clientId: string };

const echoTool = {
    name: "client_echo",
    description: "Echoes text from the AHP client",
    inputSchema: {
        type: "object" as const,
        properties: { text: { type: "string" } },
        required: ["text"],
    },
};

type Connection = Awaited<ReturnType<typeof connectAhp>>;
type Subscription = Awaited<ReturnType<Connection["client"]["subscribe"]>>["subscription"];

/** Test-side adapter around the standard AHP 0.9 client; no CAPI proxy involvement. */
export class AhpTestDriver {
    private connections = new Map<
        string,
        {
            ahp: Connection;
            githubToken: string;
            chats: Map<string, { uri: string; subscription: Subscription }>;
        }
    >();

    async request(command: AhpTestCommand): Promise<unknown> {
        if (command.op === "connect") {
            const url = new URL(command.url);
            assert(
                ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
                "AHP fixtures must use a local listener"
            );
            const ahp = await connectAhp(command, undefined, command.clientId);
            try {
                assert(!this.connections.has(ahp.clientId), "Close the previous AHP client first");
                await authenticateAhp(ahp, command.githubToken);
                this.connections.set(ahp.clientId, {
                    ahp,
                    githubToken: command.githubToken,
                    chats: new Map(),
                });
                return { clientId: ahp.clientId };
            } catch (error) {
                await ahp.client.shutdown();
                throw error;
            }
        }
        const connection = this.connections.get(command.clientId);
        assert(connection, "Unknown AHP test connection");
        const { ahp, chats } = connection;
        switch (command.op) {
            case "create": {
                const session = await createAhpSession(
                    ahp,
                    command.workDir,
                    connection.githubToken,
                    command.clientTools ? [echoTool] : []
                );
                chats.set(session.sessionId, {
                    uri: session.chatUri,
                    subscription: session.subscription,
                });
                return { sessionId: session.sessionId, sessionUri: session.sessionUri };
            }
            case "attach": {
                const uri = `ahp-session:/${command.sessionId}`;
                const listed = await ahp.client.request("listSessions", {
                    channel: "ahp-root://",
                });
                assert(
                    listed.items.some((item) => item.resource === uri),
                    "Session must be discoverable"
                );
                const session = await ahp.client.subscribe(uri);
                const state = session.result.snapshot?.state as SessionState | undefined;
                assert.equal(state?.lifecycle, "ready");
                assert(state?.defaultChat, "Attached session must have a default chat");
                const chat = await ahp.client.subscribe(state.defaultChat);
                chats.set(command.sessionId, {
                    uri: state.defaultChat,
                    subscription: chat.subscription,
                });
                if (command.clientTools) {
                    ahp.client.dispatch(uri, {
                        type: ActionType.SessionActiveClientSet,
                        activeClient: {
                            clientId: ahp.clientId,
                            displayName: "Resumed tool owner",
                            tools: [echoTool],
                        },
                    });
                    await waitFor(async () => {
                        const { result } = await ahp.client.subscribe(uri);
                        const active = (result.snapshot?.state as SessionState).activeClients;
                        return active.some((client) => client.clientId === ahp.clientId);
                    }, "active AHP client");
                }
                return { history: (chat.result.snapshot?.state as ChatState).turns };
            }
            case "turn": {
                const target = chats.get(command.sessionId);
                assert(target, "Create or attach the session before sending a turn");
                let clientToolCalls = 0;
                const response = await streamedTurn(
                    ahp.client,
                    target.uri,
                    target.subscription,
                    command.prompt,
                    "claude-sonnet-5",
                    undefined,
                    command.clientTools
                        ? {
                              clientId: ahp.clientId,
                              handlers: {
                                  client_echo: (input) => {
                                      assert.deepEqual(input, { text: "ping" });
                                      clientToolCalls++;
                                      return "CLIENT_ECHO_ping";
                                  },
                              },
                          }
                        : undefined
                );
                return { ...response, clientToolCalls };
            }
            case "stopped":
                await waitFor(() => ahp.transport.lastClose !== null, "AHP client disconnect");
                await assertListenerClosed(command.url);
                return {};
            case "close":
                this.connections.delete(command.clientId);
                await ahp.client.shutdown();
                return {};
            default:
                throw new Error("Unknown AHP test command");
        }
    }

    async close(): Promise<void> {
        const pending = [...this.connections.values()];
        this.connections.clear();
        await Promise.all(pending.map(({ ahp }) => ahp.client.shutdown()));
    }
}

async function waitFor(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (!(await condition())) {
        assert(Date.now() < deadline, `Timed out: ${label}`);
        await delay(10);
    }
}

async function assertListenerClosed(address: string): Promise<void> {
    const url = new URL(address);
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
}

const driver = new AhpTestDriver();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdout.write(JSON.stringify({ ready: true }) + "\n");
try {
    for await (const line of input) {
        try {
            const result = await driver.request(JSON.parse(line) as AhpTestCommand);
            process.stdout.write(JSON.stringify({ result }) + "\n");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stdout.write(JSON.stringify({ error: message }) + "\n");
        }
    }
} finally {
    await driver.close();
}
