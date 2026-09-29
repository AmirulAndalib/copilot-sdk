/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    accessSync,
    closeSync,
    constants,
    openSync,
    readFileSync,
    readSync,
    realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getRuntimePlatform, materializeRuntimeBundle } from "../../../src/runtimeArtifacts.js";
import {
    validateCandidateSources,
    type CandidateSources,
} from "../../../../samples/runtime-host/candidate-sources.js";

/** Local-build attestation accompanying an assembled, unpublished runtime package. */
interface LocalHostCandidate {
    schemaVersion: 3;
    kind: "local-runtime-host-candidate";
    packageRoot: string;
    platform: string;
    sources: CandidateSources;
    artifacts: Record<"runtime" | "provider", { path: string; sourcePath: string; sha256: string }>;
}

function inside(root: string, path: string): boolean {
    const suffix = relative(root, path);
    return (
        suffix !== "" && !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`)
    );
}

function sha256(path: string): string {
    const hash = createHash("sha256");
    const descriptor = openSync(path, "r");
    try {
        const buffer = Buffer.alloc(1024 * 1024);
        let length: number;
        while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) {
            hash.update(buffer.subarray(0, length));
        }
        return hash.digest("hex");
    } finally {
        closeSync(descriptor);
    }
}

export function candidateHostArtifacts(manifestPath: string) {
    assert(isAbsolute(manifestPath), "Candidate manifest path must be absolute");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as LocalHostCandidate;
    assert.equal(
        manifest.schemaVersion,
        3,
        "Restage candidates with linked-library source provenance"
    );
    assert.equal(manifest.kind, "local-runtime-host-candidate");
    assert.equal(manifest.platform, getRuntimePlatform());
    assert(isAbsolute(manifest.packageRoot), "Candidate package root must be absolute");
    const packageRoot = realpathSync(manifest.packageRoot);
    const sourceRoots = validateCandidateSources(
        manifest.sources,
        fileURLToPath(new URL("../../../../", import.meta.url))
    );

    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    assert.equal(packageJson.copilotRuntime?.sourceRepository, manifest.sources.runtime.repository);
    assert.equal(packageJson.copilotRuntime?.sourceSha, manifest.sources.runtime.commit);
    assert(
        [
            `@github/copilot-${manifest.platform}`,
            `@github/copilot-sdk-${manifest.platform}`,
        ].includes(packageJson.name),
        "Candidate must be an assembled platform runtime package"
    );

    const prebuilds = join("prebuilds", manifest.platform);
    for (const [name, filename, source] of [
        ["runtime", "copilot-runtime", "runtime"],
        ["provider", "runtime.node", "runtime"],
    ] as const) {
        const artifact = manifest.artifacts[name];
        assert.equal(artifact.path, join(prebuilds, filename));
        assert.match(artifact.sha256, /^[a-f0-9]{64}$/, `${name} needs a SHA-256 checksum`);
        assert(isAbsolute(artifact.sourcePath), `${name} source artifact must be absolute`);
        const sourcePath = realpathSync(artifact.sourcePath);
        assert(
            inside(sourceRoots[source], sourcePath),
            `${name} must come from its local checkout`
        );
        assert(
            !sourcePath.includes(`${sep}node_modules${sep}`),
            `${name} cannot be a released build`
        );
        const stagedPath = realpathSync(resolve(packageRoot, artifact.path));
        assert(inside(packageRoot, stagedPath), `${name} must be inside the candidate package`);
        assert.equal(sha256(sourcePath), artifact.sha256, `${name} local build checksum mismatch`);
        assert.equal(sha256(stagedPath), artifact.sha256, `${name} candidate checksum mismatch`);
    }

    // Exercise the SDK's real materializer, without a companion host executable.
    const runtimePath = materializeRuntimeBundle(
        { packageRoot, platform: manifest.platform },
        join(dirname(manifestPath), ".runtime-host-materialized")
    );
    const providerPath = join(dirname(runtimePath), "runtime.node");
    for (const [name, path] of [
        ["runtime", runtimePath],
        ["provider", providerPath],
    ] as const) {
        assert.equal(
            sha256(path),
            manifest.artifacts[name].sha256,
            `${name} materialization mismatch`
        );
        accessSync(path, name === "provider" ? constants.R_OK : constants.X_OK);
    }
    return {
        runtimePath,
        providerPath,
        bundled: true,
        // Undefined values are omitted by Node's child_process.spawn; empty
        // strings would still select the runtime's development-override branch.
        env: {
            COPILOT_CLI_PATH: undefined,
            COPILOT_RUNTIME_PROVIDER_LIB: undefined,
        },
    };
}
