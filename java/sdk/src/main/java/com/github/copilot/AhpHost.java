/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

package com.github.copilot;

import com.github.copilot.generated.rpc.HostDisposeParams;
import com.github.copilot.generated.rpc.HostPublishSessionParams;
import com.github.copilot.generated.rpc.HostPublishSessionResult;
import com.github.copilot.generated.rpc.HostStartResult;
import com.github.copilot.generated.rpc.ServerHostApi;
import java.util.concurrent.CompletableFuture;

/**
 * A ready, connection-owned AHP listener. The handle remains bound to its
 * original transport across client reconnects. Disposal never deletes
 * application sessions.
 */
@CopilotExperimental
public final class AhpHost implements AutoCloseable {
    private final HostStartResult info;
    private final ServerHostApi rpc;

    AhpHost(HostStartResult info, ServerHostApi rpc) {
        this.info = info;
        this.rpc = rpc;
    }

    /**
     * Gets the listener identity.
     *
     * @return the listener identity
     */
    public String getHostId() {
        return info.hostId();
    }

    /**
     * Gets the bound address.
     *
     * @return the actual bound WebSocket URL
     */
    public String getUrl() {
        return info.url();
    }

    /**
     * Gets the secret token.
     *
     * @return the token, or {@code null} when authentication is disabled
     */
    public String getToken() {
        return info.token();
    }

    /**
     * Gets the legacy process ID.
     *
     * @return the process ID, or {@code null} for in-process hosting
     */
    public Long getPid() {
        return info.pid();
    }

    /**
     * Stops the listener and joins runtime cleanup. Every call reaches the runtime,
     * including concurrent and repeated disposal calls.
     *
     * @return completion of listener cleanup
     */
    public CompletableFuture<Void> dispose() {
        return rpc.dispose(new HostDisposeParams(info.hostId()));
    }

    /**
     * Publishes an exact resident session attached to the owning client, without
     * invoking a factory or transferring session ownership.
     *
     * @param sessionId
     *            resident session identity
     * @return the published AHP session identity
     */
    public CompletableFuture<HostPublishSessionResult> publishSession(String sessionId) {
        return rpc.publishSession(new HostPublishSessionParams(info.hostId(), sessionId));
    }

    /** Disposes the listener and waits for acknowledged cleanup. */
    @Override
    public void close() {
        dispose().join();
    }
}
