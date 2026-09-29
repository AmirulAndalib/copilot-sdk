/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
    HostExitedNotification,
    HostStartResult,
    HostPublishSessionResult,
} from "./generated/rpc.js";
import type { CopilotSession } from "./session.js";
import type { SessionConfig, ResumeSessionConfig } from "./types.js";

/** Host-selected defaults for a fresh application-owned session. @experimental */
export interface AhpSessionCreateRequest {
    /** Pass these settings to createSession, adding your prompt, tools and callbacks. */
    config: Omit<SessionConfig, "onPermissionRequest">;
    /** Aborted when participation ends, including timeout or owner disconnection. */
    signal: AbortSignal;
}

/** Host-selected settings for resuming a durable application-owned AHP session. @experimental */
export interface AhpSessionResumeRequest {
    sessionId: string;
    /** Pass to resumeSession, adding application tools, hooks and callbacks. */
    config: Omit<ResumeSessionConfig, "onPermissionRequest">;
    /** Aborted when participation ends; late results are still released exactly once. */
    signal: AbortSignal;
}

/**
 * A listener-task exit report, or an owner disconnect that cannot acknowledge cleanup.
 * `reason: "exited"` means the hosting task failed, not that the runtime process died.
 * In-process hosts have no process exit code (`exitCode` is absent).
 * @experimental
 */
export type AhpHostExit = HostExitedNotification;

/**
 * Options for a runtime-supervised AHP listener. Callbacks are captured at startup;
 * later changes to this options object do not reconfigure an existing host.
 * @experimental
 */
export interface AhpHostOptions {
    /** Listener hostname. The runtime defaults to 127.0.0.1. */
    hostname?: string;
    /** Listener port. Omitted or zero asks the runtime for an available port. */
    port?: number;
    /** Connection token. The runtime generates one when required and omitted. */
    token?: string;
    /** Whether the listener requires token authentication. */
    requireConnectionToken?: boolean;
    /** Called at most once when hosting ends, not on runtime process death. Local, never serialized. */
    onExit?: (exit: AhpHostExit) => void;
    /**
     * Materialize a fresh session on this client. Preserve the supplied config
     * (including its sessionId and workingDirectory); add your own prompt and tools.
     * The callback and all tool/hook functions stay in the application.
     */
    createSession?: (request: AhpSessionCreateRequest) => Promise<CopilotSession>;
    /**
     * Resume a durable session previously created by an application factory.
     * Return the original object from this client's resumeSession, or an existing
     * attached original without reconfiguring it. Published resident sessions
     * attach directly and never invoke this callback.
     */
    resumeSession?: (request: AhpSessionResumeRequest) => Promise<CopilotSession>;
    /**
     * Called once per handoff with the original returned object after AHP detaches
     * or the handoff fails. The SDK never disconnects or destroys this object.
     */
    onSessionReleased?: (session: CopilotSession) => void | Promise<void>;
}

/**
 * A connection-owned AHP listener supervised by the runtime.
 *
 * The runtime hosts the listener in-process, without a companion executable. Disconnecting
 * the owning client also stops the host; reconnecting does not reclaim it.
 * Stopping a host does not delete its underlying sessions.
 * Its durable AHP catalog is shared by successive hosts in the runtime's
 * effective Copilot home; a concurrent host for that catalog is rejected.
 *
 * @experimental
 */
export class AhpHost {
    readonly hostId: string;
    readonly url: string;
    /** Connection token, when required by the listener. Treat this value as a secret. */
    readonly token: string | undefined;
    /** Legacy separate host process ID. Absent for in-process listeners; use dispose() to stop. */
    readonly pid: number | undefined;

    /** @internal */
    constructor(
        info: HostStartResult,
        private readonly disposeHost: () => Promise<void>,
        private readonly publishHostSession: (
            sessionId: string
        ) => Promise<HostPublishSessionResult>
    ) {
        this.hostId = info.hostId;
        this.url = info.url;
        this.token = info.token;
        this.pid = info.pid;
    }

    /** Ask the runtime to stop the listener and await its cleanup, on every call. */
    dispose(): Promise<void> {
        return this.disposeHost();
    }

    /** Publish an existing session attached to this client, until this listener stops. */
    publishSession(sessionId: string): Promise<HostPublishSessionResult> {
        return this.publishHostSession(sessionId);
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.dispose();
    }
}
