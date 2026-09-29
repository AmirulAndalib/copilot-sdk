/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
    CopilotClient,
    PermissionRequest,
    PreToolUseHookInput,
    PreToolUseHookOutput,
    PostToolUseHookInput,
    PostToolUseHookOutput,
} from "../../src/index.js";
import { approveAll, defineTool, RuntimeConnection } from "../../src/index.js";
import {
    createSdkTestContext,
    getLegacyCliPathForTests,
    isInProcessTransport,
} from "./harness/sdkTestContext.js";

describe("Session hooks", async () => {
    const ctx = await createSdkTestContext();
    const { copilotClient: client, workDir } = ctx;

    it("should invoke preToolUse hook when model runs a tool", async () => {
        const preToolUseInputs: PreToolUseHookInput[] = [];
        const invocationSessionIds: string[] = [];

        const session = await client.createSession({
            onPermissionRequest: approveAll,
            hooks: {
                onPreToolUse: async (input, invocation) => {
                    preToolUseInputs.push(input);
                    invocationSessionIds.push(invocation.sessionId);
                    // Allow the tool to run
                    return { permissionDecision: "allow" } as PreToolUseHookOutput;
                },
            },
        });

        // Create a file for the model to read
        await writeFile(join(workDir, "hello.txt"), "Hello from the test!");

        await session.sendAndWait({
            prompt: "Read the contents of hello.txt and tell me what it says",
        });

        // Should have received at least one preToolUse hook call
        expect(preToolUseInputs.length).toBeGreaterThan(0);
        expect(invocationSessionIds.every((sessionId) => sessionId === session.sessionId)).toBe(
            true
        );

        // Should have received the tool name
        expect(preToolUseInputs.some((input) => input.toolName)).toBe(true);

        await session.disconnect();
    });

    it("should invoke postToolUse hook after model runs a tool", async () => {
        const postToolUseInputs: PostToolUseHookInput[] = [];
        const invocationSessionIds: string[] = [];

        const session = await client.createSession({
            onPermissionRequest: approveAll,
            hooks: {
                onPostToolUse: async (input, invocation) => {
                    postToolUseInputs.push(input);
                    invocationSessionIds.push(invocation.sessionId);
                    return null as PostToolUseHookOutput;
                },
            },
        });

        // Create a file for the model to read
        await writeFile(join(workDir, "world.txt"), "World from the test!");

        await session.sendAndWait({
            prompt: "Read the contents of world.txt and tell me what it says",
        });

        // Should have received at least one postToolUse hook call
        expect(postToolUseInputs.length).toBeGreaterThan(0);
        expect(invocationSessionIds.every((sessionId) => sessionId === session.sessionId)).toBe(
            true
        );

        // Should have received the tool name and result
        expect(postToolUseInputs.some((input) => input.toolName)).toBe(true);
        expect(postToolUseInputs.some((input) => input.toolResult !== undefined)).toBe(true);

        await session.disconnect();
    });

    it("should invoke both preToolUse and postToolUse hooks for a single tool call", async () => {
        const preToolUseInputs: PreToolUseHookInput[] = [];
        const postToolUseInputs: PostToolUseHookInput[] = [];

        const session = await client.createSession({
            onPermissionRequest: approveAll,
            hooks: {
                onPreToolUse: async (input) => {
                    preToolUseInputs.push(input);
                    return { permissionDecision: "allow" } as PreToolUseHookOutput;
                },
                onPostToolUse: async (input) => {
                    postToolUseInputs.push(input);
                    return null as PostToolUseHookOutput;
                },
            },
        });

        await writeFile(join(workDir, "both.txt"), "Testing both hooks!");

        await session.sendAndWait({
            prompt: "Read the contents of both.txt",
        });

        // Both hooks should have been called
        expect(preToolUseInputs.length).toBeGreaterThan(0);
        expect(postToolUseInputs.length).toBeGreaterThan(0);

        // The same tool should appear in both
        const preToolNames = preToolUseInputs.map((i) => i.toolName);
        const postToolNames = postToolUseInputs.map((i) => i.toolName);
        const commonTool = preToolNames.find((name) => postToolNames.includes(name));
        expect(commonTool).toBeDefined();

        await session.disconnect();
    });

    it("should deny tool execution when preToolUse returns deny", async () => {
        const preToolUseInputs: PreToolUseHookInput[] = [];

        const session = await client.createSession({
            onPermissionRequest: approveAll,
            hooks: {
                onPreToolUse: async (input) => {
                    preToolUseInputs.push(input);
                    // Deny all tool calls
                    return { permissionDecision: "deny" } as PreToolUseHookOutput;
                },
            },
        });

        // Create a file
        const originalContent = "Original content that should not be modified";
        await writeFile(join(workDir, "protected.txt"), originalContent);

        const response = await session.sendAndWait({
            prompt: "Edit protected.txt and replace 'Original' with 'Modified'",
        });

        // The hook should have been called
        expect(preToolUseInputs.length).toBeGreaterThan(0);

        // The response should indicate the tool was denied (behavior may vary)
        // At minimum, we verify the hook was invoked
        expect(response).toBeDefined();

        // Strengthen: verify the actual deny behavior — the protected file was NOT
        // modified by the runtime even though the LLM tried to edit it. The
        // pre-tool-use hook denial blocks tool execution before it can mutate state.
        const actualContent = await readFile(join(workDir, "protected.txt"), "utf-8");
        expect(actualContent).toBe(originalContent);

        await session.disconnect();
    });

    // Disconnecting the last owner tears the session down, so each resume must register
    // the SDK's hooks with the freshly restored hook service.
    async function expectPreToolUseAfterResume(target: CopilotClient): Promise<void> {
        const preToolUseInputs: PreToolUseHookInput[] = [];
        const permissionRequests: PermissionRequest[] = [];
        const sessionOptions = () => ({
            tools: [
                defineTool("encrypt_string", {
                    description: "Encrypts a string",
                    parameters: z.object({
                        input: z.string().describe("String to encrypt"),
                    }),
                    handler: ({ input }: { input: string }) => input.toUpperCase(),
                }),
            ],
            // Records rather than denies so a regression surfaces as a clear assertion
            // failure instead of a model-dependent denial transcript.
            onPermissionRequest: (request: PermissionRequest) => {
                permissionRequests.push(request);
                return { kind: "approve-once" } as const;
            },
            hooks: {
                onPreToolUse: async (input: PreToolUseHookInput) => {
                    preToolUseInputs.push(input);
                    return { permissionDecision: "allow" } as PreToolUseHookOutput;
                },
            },
        });

        let sessionId: string;
        {
            await using session1 = await target.createSession(sessionOptions());
            sessionId = session1.sessionId;
            await session1.sendAndWait({
                prompt: "Use encrypt_string to encrypt this string: Hello",
            });
            expect(preToolUseInputs.map((input) => input.toolName)).toEqual(["encrypt_string"]);
        }

        await using session2 = await target.resumeSession(sessionId, sessionOptions());
        const answer = await session2.sendAndWait({
            prompt: "Use encrypt_string to encrypt this string: World",
        });

        expect(preToolUseInputs.map((input) => input.toolName)).toEqual([
            "encrypt_string",
            "encrypt_string",
        ]);
        expect(permissionRequests).toEqual([]);
        // Validate the final assistant response arrived (guards against truncated captures)
        expect(answer?.data.content).toContain("WORLD");
    }

    it("should invoke preToolUse hook for a custom tool after disconnect and resume", async () => {
        await expectPreToolUseAfterResume(client);
    });

    // The legacy JavaScript CLI host tears sessions down through a separate path.
    it.skipIf(isInProcessTransport)(
        "should invoke preToolUse hook for a custom tool after disconnect and resume on the legacy CLI",
        async () => {
            const legacyClient = ctx.createClient({
                connection: RuntimeConnection.forStdio({
                    path: await getLegacyCliPathForTests(),
                }),
            });
            try {
                await expectPreToolUseAfterResume(legacyClient);
            } finally {
                await legacyClient.stop();
            }
        }
    );
});
