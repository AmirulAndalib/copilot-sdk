/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

package com.github.copilot;

import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

/**
 * Options for an in-process AHP listener. Factories must return the exact
 * session registered on the owning client with the requested identity and
 * settings. Release callbacks end a participation, not the application's
 * session lifetime.
 */
@CopilotExperimental
public final class AhpHostOptions {
    private String hostname;
    private Integer port;
    private String token;
    private Boolean requireConnectionToken;
    private Function<AhpSessionCreateRequest, CompletableFuture<CopilotSession>> createSession;
    private Function<AhpSessionResumeRequest, CompletableFuture<CopilotSession>> resumeSession;
    private Function<CopilotSession, CompletableFuture<Void>> onSessionReleased;
    private Function<AhpHostExit, CompletableFuture<Void>> onExit;

    /**
     * Creates options with loopback binding, an ephemeral port, and token
     * authentication.
     */
    public AhpHostOptions() {
    }

    AhpHostOptions(AhpHostOptions options) {
        hostname = options.hostname;
        port = options.port;
        token = options.token;
        requireConnectionToken = options.requireConnectionToken;
        createSession = options.createSession;
        resumeSession = options.resumeSession;
        onSessionReleased = options.onSessionReleased;
        onExit = options.onExit;
    }

    /**
     * Gets the bind hostname.
     *
     * @return the hostname, or {@code null} for loopback
     */
    public String getHostname() {
        return hostname;
    }

    /**
     * Sets the bind hostname.
     *
     * @param hostname
     *            bind hostname
     * @return these options
     */
    public AhpHostOptions setHostname(String hostname) {
        this.hostname = hostname;
        return this;
    }

    /**
     * Gets the requested port.
     *
     * @return the port, or {@code null} for an ephemeral port
     */
    public Integer getPort() {
        return port;
    }

    /**
     * Sets the bind port.
     *
     * @param port
     *            bind port; zero requests an ephemeral port
     * @return these options
     */
    public AhpHostOptions setPort(Integer port) {
        this.port = port;
        return this;
    }

    /**
     * Gets the connection token.
     *
     * @return the token, or {@code null} to generate one
     */
    public String getToken() {
        return token;
    }

    /**
     * Sets the connection token.
     *
     * @param token
     *            nonempty connection token
     * @return these options
     */
    public AhpHostOptions setToken(String token) {
        this.token = token;
        return this;
    }

    /**
     * Gets the authentication policy.
     *
     * @return whether authentication is required; {@code null} means true
     */
    public Boolean getRequireConnectionToken() {
        return requireConnectionToken;
    }

    /**
     * Sets the authentication policy.
     *
     * @param required
     *            whether to require token authentication
     * @return these options
     */
    public AhpHostOptions setRequireConnectionToken(Boolean required) {
        requireConnectionToken = required;
        return this;
    }

    /**
     * Gets the creation callback.
     *
     * @return the application creation callback, or {@code null}
     */
    public Function<AhpSessionCreateRequest, CompletableFuture<CopilotSession>> getCreateSession() {
        return createSession;
    }

    /**
     * Sets the application creation callback.
     *
     * @param callback
     *            application creation callback
     * @return these options
     */
    public AhpHostOptions setCreateSession(
            Function<AhpSessionCreateRequest, CompletableFuture<CopilotSession>> callback) {
        createSession = callback;
        return this;
    }

    /**
     * Gets the resume callback.
     *
     * @return the application resume callback, or {@code null}
     */
    public Function<AhpSessionResumeRequest, CompletableFuture<CopilotSession>> getResumeSession() {
        return resumeSession;
    }

    /**
     * Sets the application resume callback.
     *
     * @param callback
     *            application resume callback
     * @return these options
     */
    public AhpHostOptions setResumeSession(
            Function<AhpSessionResumeRequest, CompletableFuture<CopilotSession>> callback) {
        resumeSession = callback;
        return this;
    }

    /**
     * Gets the release callback.
     *
     * @return the participation-release callback, or {@code null}
     */
    public Function<CopilotSession, CompletableFuture<Void>> getOnSessionReleased() {
        return onSessionReleased;
    }

    /**
     * Sets the participation-release callback.
     *
     * @param callback
     *            callback receiving the exact factory result once
     * @return these options
     */
    public AhpHostOptions setOnSessionReleased(Function<CopilotSession, CompletableFuture<Void>> callback) {
        onSessionReleased = callback;
        return this;
    }

    /**
     * Gets the exit callback.
     *
     * @return the listener exit callback, or {@code null}
     */
    public Function<AhpHostExit, CompletableFuture<Void>> getOnExit() {
        return onExit;
    }

    /**
     * Sets the listener exit callback.
     *
     * @param callback
     *            callback receiving the listener's final outcome once
     * @return these options
     */
    public AhpHostOptions setOnExit(Function<AhpHostExit, CompletableFuture<Void>> callback) {
        onExit = callback;
        return this;
    }
}
