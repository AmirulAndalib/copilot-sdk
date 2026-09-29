/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// AUTO-GENERATED FILE - DO NOT EDIT
// Generated from: api.schema.json

package com.github.copilot.generated.rpc;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.github.copilot.CopilotExperimental;
import javax.annotation.processing.Generated;

/**
 * Normalized listener settings delivered only to the supervised hosting participant.
 *
 * @apiNote This method is experimental and may change in a future version.
 * @since 1.0.0
 */
@CopilotExperimental
@javax.annotation.processing.Generated("copilot-sdk-codegen")
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record HostGetConfigurationResult(
    /** Hostname or IP address to bind. */
    @JsonProperty("hostname") String hostname,
    /** Port to bind, with zero requesting OS allocation. */
    @JsonProperty("port") Long port,
    /** Secret connection token, absent when authentication is disabled. */
    @JsonProperty("token") String token,
    /** Whether the listener requires token authentication. */
    @JsonProperty("requireConnectionToken") Boolean requireConnectionToken,
    /** Whether session materialization is delegated to the owning application. */
    @JsonProperty("sessionFactory") Boolean sessionFactory,
    /** Whether app-owned durable sessions are resumed by the owning application. */
    @JsonProperty("resumeFactory") Boolean resumeFactory
) {
}
