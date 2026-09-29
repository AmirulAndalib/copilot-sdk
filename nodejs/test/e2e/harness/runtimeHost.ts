/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { accessSync, constants, realpathSync } from "node:fs";
import { isAbsolute, sep } from "node:path";
import type { AhpHost } from "../../../src/index.js";
import { waitForCondition } from "./sdkTestHelper.js";
import { candidateHostArtifacts } from "./runtimeHostCandidate.js";
import type { connectAhp } from "./ahpClient.js";
import { assertListenerClosed } from "./runtimeHostTopology.js";
export { assertRuntimeListener } from "./runtimeHostTopology.js";
export {
    authenticateAhp,
    connectAhp,
    createAhpSession,
    streamedTurn,
    withDeadline,
} from "./ahpClient.js";

export function localHostArtifacts() {
    const candidate = process.env.COPILOT_RUNTIME_HOST_CANDIDATE_MANIFEST;
    if (candidate) return candidateHostArtifacts(candidate);
    function artifact(name: string, executable = true): string {
        const value = process.env[name];
        assert(value && isAbsolute(value), `${name} must name an absolute, locally built artifact`);
        const path = realpathSync(value);
        assert(
            !path.split(sep).includes("node_modules"),
            `${name} must not use a released runtime package`
        );
        accessSync(path, executable ? constants.X_OK : constants.R_OK);
        return path;
    }
    const artifacts = {
        runtimePath: artifact("COPILOT_CLI_PATH"),
        providerPath: artifact("COPILOT_RUNTIME_PROVIDER_LIB", false),
    };
    return {
        ...artifacts,
        bundled: false,
        env: {
            COPILOT_RUNTIME_PROVIDER_LIB: artifacts.providerPath,
        },
    };
}

export async function assertProcessStopped(pid: number, label: string) {
    await waitForCondition(
        () => {
            try {
                process.kill(pid, 0);
                return false;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
                return true;
            }
        },
        { timeoutMessage: `${label} was not reaped` }
    );
}

export async function assertHostStopped(
    host: AhpHost,
    ahp: Awaited<ReturnType<typeof connectAhp>>,
    runtimePid: number | false
) {
    await waitForCondition(() => ahp.transport.lastClose !== null, {
        timeoutMessage: "Existing AHP client was not disconnected",
    });
    await assertListenerClosed(host, runtimePid);
}
