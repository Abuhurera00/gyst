#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { diffLines } from "diff";
import chalk from "chalk";

class Gyst {
    constructor(repoPath = ".") {
        this.repoPath = path.join(repoPath, ".gyst");
        this.objectsPath = path.join(this.repoPath, "objects");
        this.headPath = path.join(this.repoPath, "HEAD");
        this.indexPath = path.join(this.repoPath, "index");
        // We don’t await init() here; the caller (CLI dispatcher) will await it if needed.
    }

    async init() {
        await fs.mkdir(this.objectsPath, { recursive: true });
        try {
            await fs.writeFile(this.headPath, "", { flag: "wx" });
            await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: "wx" });
            console.log("Initialized empty Gyst repository in", this.repoPath);
        } catch (error) {
            // If the folder already exists, we silently exit (no further logging).
        }
    }

    hashObject(content) {
        return crypto.createHash("sha1").update(content, "utf-8").digest("hex");
    }

    async add(fileToBeAdded) {
        // Ensure the repo is initialized before adding
        await this.init();

        let fileData;
        try {
            fileData = await fs.readFile(fileToBeAdded, "utf-8");
        } catch {
            console.error(`Error: cannot read file '${fileToBeAdded}'.`);
            process.exit(1);
        }

        const fileHash = this.hashObject(fileData);
        const newObjPath = path.join(this.objectsPath, fileHash);
        await fs.writeFile(newObjPath, fileData);
        await this.updateStagingArea(fileToBeAdded, fileHash);
        console.log(`Added file: ${fileToBeAdded}`);
    }

    async updateStagingArea(filePath, fileHash) {
        let index;
        try {
            index = JSON.parse(await fs.readFile(this.indexPath, "utf-8"));
        } catch {
            index = [];
        }
        // Remove any existing entry for this path (to prevent duplicates)
        index = index.filter((entry) => entry.path !== filePath);
        index.push({ path: filePath, hash: fileHash });
        await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
    }

    async commit(message) {
        // Ensure the repo is initialized
        await this.init();

        let index;
        try {
            index = JSON.parse(await fs.readFile(this.indexPath, "utf-8"));
        } catch {
            index = [];
        }

        if (index.length === 0) {
            console.error("No changes added to commit.");
            process.exit(1);
        }

        const parentCommit = (await this.getCurrentHead()) || null;
        const commitData = {
            timeStamp: new Date().toISOString(),
            message,
            files: index,
            parent: parentCommit,
        };

        const commitHash = this.hashObject(JSON.stringify(commitData));
        const commitPath = path.join(this.objectsPath, commitHash);
        await fs.writeFile(commitPath, JSON.stringify(commitData, null, 2));
        await fs.writeFile(this.headPath, commitHash);
        // Clear staging area
        await fs.writeFile(this.indexPath, JSON.stringify([], null, 2));

        console.log(`Commit successfully created: ${commitHash}`);
    }

    async getCurrentHead() {
        try {
            const head = await fs.readFile(this.headPath, "utf-8");
            return head.trim() === "" ? null : head.trim();
        } catch {
            return null;
        }
    }

    async log() {
        // Ensure repo exists (it might have been init’d previously)
        try {
            await fs.access(this.headPath);
        } catch {
            console.error("Error: no Gyst repository found. Did you run 'gyst init'?");
            process.exit(1);
        }

        let current = await this.getCurrentHead();
        if (!current) {
            console.log("No commits yet.");
            return;
        }

        while (current) {
            const raw = await fs.readFile(path.join(this.objectsPath, current), "utf-8");
            const commitData = JSON.parse(raw);

            console.log("_____________________\n");
            console.log(`Commit: ${current}`);
            console.log(`Date:   ${commitData.timeStamp}\n`);
            console.log(`    ${commitData.message}\n`);

            current = commitData.parent;
        }
    }

    async showCommitDiff(commitHash) {
        // Ensure repo exists
        try {
            await fs.access(this.headPath);
        } catch {
            console.error("Error: no Gyst repository found. Did you run 'gyst init'?");
            process.exit(1);
        }

        const rawCurrent = await this.getCommitRaw(commitHash);
        if (!rawCurrent) {
            console.error(`Commit ${commitHash} not found.`);
            process.exit(1);
        }
        const commitData = JSON.parse(rawCurrent);

        console.log(`Changes in commit ${commitHash}:\n`);

        for (const file of commitData.files) {
            console.log(`File: ${file.path}`);
            const fileContent = await this.getFileContent(file.hash);
            console.log(fileContent);

            if (commitData.parent) {
                const rawParent = await this.getCommitRaw(commitData.parent);
                if (!rawParent) {
                    // Parent commit missing—just skip diff
                    console.log("  (Parent commit object missing.)\n");
                    continue;
                }
                const parentCommitData = JSON.parse(rawParent);
                const parentFileContent = await this.getParentFileContent(parentCommitData, file.path);

                if (parentFileContent !== undefined) {
                    console.log("\nDiff:");
                    const diff = diffLines(parentFileContent, fileContent);
                    diff.forEach((part) => {
                        if (part.added) {
                            process.stdout.write(chalk.green("++ " + part.value));
                        } else if (part.removed) {
                            process.stdout.write(chalk.red("--" + part.value));
                        } else {
                            process.stdout.write(chalk.grey(part.value));
                        }
                    });
                    console.log("\n");
                } else {
                    console.log("  (New file in this commit)\n");
                }
            } else {
                console.log("  (First commit, no parent to diff against)\n");
            }
        }
    }

    async getParentFileContent(parentCommitData, filePath) {
        const parentFile = parentCommitData.files.find((f) => f.path === filePath);
        if (parentFile) {
            return await this.getFileContent(parentFile.hash);
        }
        return undefined;
    }

    async getCommitRaw(hash) {
        const commitPath = path.join(this.objectsPath, hash);
        try {
            return await fs.readFile(commitPath, "utf-8");
        } catch {
            return null;
        }
    }

    async getFileContent(fileHash) {
        const objectPath = path.join(this.objectsPath, fileHash);
        try {
            return await fs.readFile(objectPath, "utf-8");
        } catch {
            return "";
        }
    }
}

// ─── CLI DISPATCHER ─────────────────────────────────────────────────────────────

(async () => {
    const [, , command, ...args] = process.argv;
    const repo = new Gyst();

    switch (command) {
        case "init":
            await repo.init();
            break;

        case "add":
            if (args.length !== 1) {
                console.error("Usage: gyst add <file>");
                process.exit(1);
            }
            await repo.add(args[0]);
            break;

        case "commit":
            if (args.length < 1) {
                console.error("Usage: gyst commit <message>");
                process.exit(1);
            }
            // Join all remaining args as the commit message
            const msg = args.join(" ");
            await repo.commit(msg);
            break;

        case "log":
            await repo.log();
            break;

        case "diff":
            if (args.length !== 1) {
                console.error("Usage: gyst diff <commit-hash>");
                process.exit(1);
            }
            await repo.showCommitDiff(args[0]);
            break;

        default:
            console.log(`${chalk.red("Unknown command:")} ${command}\n\n
Usage:
  gyst init
  gyst add <file>
  gyst commit <message>
  gyst log
  gyst diff <commit-hash>
`);
            process.exit(0);
    }
})();
