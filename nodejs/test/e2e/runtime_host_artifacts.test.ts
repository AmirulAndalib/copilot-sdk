/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    localCandidateSources,
    hostingSource,
    validateCandidateSources,
    type CandidateSources,
} from "../../../samples/runtime-host/candidate-sources.js";
import { localHostArtifacts } from "./harness/runtimeHost.js";
import { candidateHostArtifacts } from "./harness/runtimeHostCandidate.js";

afterEach(() => vi.unstubAllEnvs());

describe("Runtime host monorepo source identity", () => {
    let work: string;
    let runtime: string;
    let otherSdkCheckout: string;
    let sdk: string;
    let sources: CandidateSources;
    const hostingCommit = "a".repeat(40);
    const lockfile = (
        source = `git+https://github.com/github/copilot-host?rev=${hostingCommit}#${hostingCommit}`
    ) =>
        `version = 4\n\n[[package]]\nname = "copilotd-hosting"\nversion = "0.1.0"\nsource = "${source}"\n`;

    beforeAll(() => {
        work = mkdtempSync(join(process.cwd(), ".runtime-host-sources-"));
        runtime = join(work, "runtime");
        otherSdkCheckout = join(work, "other-sdk");
        sdk = join(runtime, "src/sdk");
        for (const [checkout, directory] of [
            [runtime, sdk],
            [otherSdkCheckout, join(otherSdkCheckout, "nested")],
        ]) {
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, "tracked"), "source\n");
            if (checkout === runtime) writeFileSync(join(runtime, "Cargo.lock"), lockfile());
            for (const args of [
                ["init", "--quiet"],
                ["add", "."],
                [
                    "-c",
                    "user.name=SDK test",
                    "-c",
                    "user.email=sdk-test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "commit",
                    "--quiet",
                    "-m",
                    "fixture",
                ],
            ]) {
                execFileSync("git", ["-C", checkout, ...args], { stdio: "pipe" });
            }
        }
        sources = localCandidateSources(runtime, sdk);
    });

    afterAll(() => {
        if (work) rmSync(work, { recursive: true, force: true });
    });

    it("attests the runtime, its SDK subtree, and the locked hosting library", () => {
        expect(sources.sdk).toEqual({ ...sources.runtime, path: "src/sdk" });
        expect(sources.hosting).toEqual({
            repository: "github/copilot-host",
            commit: hostingCommit,
        });
        expect(validateCandidateSources(sources, sdk)).toEqual({ runtime, sdk });
    });

    it.each([
        `git+https://example.invalid/host?rev=${hostingCommit}#${hostingCommit}`,
        `git+https://github.com/github/copilot-host?branch=main#${hostingCommit}`,
        `git+https://github.com/github/copilot-host?rev=${"b".repeat(40)}#${hostingCommit}`,
        "registry+https://github.com/rust-lang/crates.io-index",
    ])("rejects an unrelated, floating, or mismatched library source: %s", (source) => {
        try {
            writeFileSync(join(runtime, "Cargo.lock"), lockfile(source));
            expect(() => hostingSource(runtime)).toThrow();
        } finally {
            writeFileSync(join(runtime, "Cargo.lock"), lockfile());
        }
    });

    it("rejects missing and ambiguous hosting library entries", () => {
        try {
            for (const value of ["version = 4\n", lockfile() + lockfile()]) {
                writeFileSync(join(runtime, "Cargo.lock"), value);
                expect(() => hostingSource(runtime)).toThrow("one copilotd-hosting library");
            }
        } finally {
            writeFileSync(join(runtime, "Cargo.lock"), lockfile());
        }
    });

    it("rejects a manifest with a different linked hosting revision", () => {
        const changed = structuredClone(sources);
        changed.hosting.commit = "b".repeat(40);
        expect(() => validateCandidateSources(changed, sdk)).toThrow("runtime's locked library");
    });

    it("rejects a separate SDK repository identity", () => {
        const changed = structuredClone(sources);
        changed.sdk.repository = "github/copilot-sdk";
        expect(() => validateCandidateSources(changed, sdk)).toThrow();
    });

    it("rejects an SDK commit different from the runtime commit", () => {
        const changed = structuredClone(sources);
        changed.sdk.commit = "0".repeat(40);
        expect(() => validateCandidateSources(changed, sdk)).toThrow(
            "SDK must use the runtime commit"
        );
    });

    it("rejects an SDK recorded under another checkout", () => {
        const changed = structuredClone(sources);
        changed.sdk.checkout = otherSdkCheckout;
        expect(() => validateCandidateSources(changed, sdk)).toThrow(
            "SDK must belong to the runtime checkout"
        );
    });

    it("rejects an incorrect SDK subtree", () => {
        const changed = structuredClone(sources);
        Object.assign(changed.sdk, { path: "." });
        expect(() => validateCandidateSources(changed, sdk)).toThrow(
            "SDK must identify the src/sdk subtree"
        );
    });

    it("rejects a candidate used by another SDK checkout", () => {
        expect(() => validateCandidateSources(sources, otherSdkCheckout)).toThrow(
            "Candidate must use this local SDK checkout"
        );
    });

    it("rejects a separate Git repository nested at the SDK path", () => {
        try {
            execFileSync("git", ["-C", sdk, "init", "--quiet"], { stdio: "pipe" });
            expect(() => validateCandidateSources(sources, sdk)).toThrow(
                "SDK must be part of the runtime repository"
            );
        } finally {
            rmSync(join(sdk, ".git"), { recursive: true, force: true });
        }
    });

    it("requires the runtime repository root", () => {
        const changed = structuredClone(sources);
        changed.runtime.checkout = sdk;
        expect(() => validateCandidateSources(changed, sdk)).toThrow(
            "runtime checkout must be a repository root"
        );
    });

    it("rejects stale runtime source revisions", () => {
        const changed = structuredClone(sources);
        changed.runtime.commit = "0".repeat(40);
        expect(() => validateCandidateSources(changed, sdk)).toThrow(
            "runtime candidate source must match the local checkout"
        );
    });

    it("rejects tracked SDK edits before staging", () => {
        const tracked = join(sdk, "tracked");
        try {
            writeFileSync(tracked, "changed\n");
            expect(() => localCandidateSources(runtime, sdk)).toThrow(
                "Commit tracked changes in runtime before attesting a source revision"
            );
        } finally {
            writeFileSync(tracked, "source\n");
        }
    });

    it.each([1, 2])("requires restaging legacy version %s manifests", (schemaVersion) => {
        const manifest = join(work, "legacy.json");
        writeFileSync(manifest, JSON.stringify({ schemaVersion }));
        expect(() => candidateHostArtifacts(manifest)).toThrow(
            "Restage candidates with linked-library source provenance"
        );
    });
});

describe("Runtime host artifact selection", () => {
    it("requires only the runtime and provider, not a companion executable", () => {
        vi.stubEnv("COPILOT_RUNTIME_HOST_CANDIDATE_MANIFEST", undefined);
        // Artifact-selector unit fixture only; live E2Es independently attest /proc topology.
        vi.stubEnv("COPILOT_CLI_PATH", process.execPath);
        vi.stubEnv("COPILOT_RUNTIME_PROVIDER_LIB", process.execPath);
        expect(localHostArtifacts()).toMatchObject({
            runtimePath: process.execPath,
            providerPath: process.execPath,
        });
    });

    it("requires an absolute candidate provenance manifest", () => {
        expect(() => candidateHostArtifacts("candidate.json")).toThrow(
            "Candidate manifest path must be absolute"
        );
    });

    it("fails closed instead of falling back when the selected candidate is missing", () => {
        const missing = fileURLToPath(new URL(`./missing-${randomUUID()}.json`, import.meta.url));
        vi.stubEnv("COPILOT_RUNTIME_HOST_CANDIDATE_MANIFEST", missing);
        vi.stubEnv("COPILOT_CLI_PATH", "/unrelated-development-runtime");
        vi.stubEnv("COPILOT_RUNTIME_PROVIDER_LIB", "/unrelated-development-provider");
        expect(() => localHostArtifacts()).toThrow(missing);
    });

    it.each(["COPILOT_CLI_PATH", "COPILOT_RUNTIME_PROVIDER_LIB"])(
        "does not accept an npm artifact as an unattested %s",
        (name) => {
            vi.stubEnv("COPILOT_RUNTIME_HOST_CANDIDATE_MANIFEST", undefined);
            vi.stubEnv("COPILOT_CLI_PATH", process.execPath);
            vi.stubEnv("COPILOT_RUNTIME_PROVIDER_LIB", process.execPath);
            vi.stubEnv(
                name,
                fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url))
            );
            expect(() => localHostArtifacts()).toThrow(
                `${name} must not use a released runtime package`
            );
        }
    );
});
