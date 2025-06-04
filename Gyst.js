#!/usr/bin/env node

import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { diffLines } from "diff";
import chalk from "chalk";
import { Command } from "commander";

const program = new Command();

class Gyst {
    constructor(repoPath = ".") {
        this.repoPath = path.join(repoPath, ".gyst");  // .gyst is the default directory for the repository
        this.objectsPath = path.join(this.repoPath, "objects");   // .gyst/objects is where all objects are stored
        this.headPath = path.join(this.repoPath, "HEAD");  // .gyst/HEAD is the current branch reference
        this.indexPath = path.join(this.repoPath, "index");  // .gyst/index is the staging area
        this.init();
    }

    async init() {
        await fs.mkdir(this.objectsPath, { recursive: true });
        try {
            await fs.writeFile(this.headPath, "", { flag: "wx" }); // Create HEAD file if it doesn't exist wx: open for writing, fail if it already exists
            await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: "wx" }) // Create index file if it doesn't exist
            console.log("Initialized empty Gyst repository in", this.repoPath);
        } catch (error) {
            // console.log("Already initialized the .gyst folder.");
        }
    }

    hashObject(content) {
        return crypto.createHash("sha1").update(content, "utf-8").digest("hex");
    }

    async add(fileToBeAdded) {
        const fileData = await fs.readFile(fileToBeAdded, { encoding: "utf-8" });   // read the file content
        const fileHash = this.hashObject(fileData);  // hash the file content to create a unique identifier
        console.log(fileHash)
        const newFileHashedObjectPath = path.join(this.objectsPath, fileHash);
        await fs.writeFile(newFileHashedObjectPath, fileData); // Store the file content in the objects directory
        await this.updateStagingArea(fileToBeAdded, fileHash); // Update the staging area (index) with the new file 
        console.log(`Added file: ${fileToBeAdded}`);
    }

    async updateStagingArea(filePath, fileHash) {
        const index = JSON.parse(await fs.readFile(this.indexPath, { encoding: "utf-8" })); // Read the current index
        index.push({ path: filePath, hash: fileHash }); // Add the new file to the index
        await fs.writeFile(this.indexPath, JSON.stringify(index)); // Write the updated index back to the file
    }


    async commit(message) {
        const index = JSON.parse(await fs.readFile(this.indexPath, { encoding: "utf-8" })); // Read the current index
        const parentCommit = await this.getCurrentHead(); // Get the current HEAD reference

        const commitData = {
            timeStamp: new Date().toISOString(), // Current timestamp
            message,
            files: index, // Files staged for commit
            parent: parentCommit
        }

        const commitHash = this.hashObject(JSON.stringify(commitData)); // Hash the commit data to create a unique identifier
        const commitPath = path.join(this.objectsPath, commitHash); // Path to store the commit object
        await fs.writeFile(commitPath, JSON.stringify(commitData)); // Write the commit data to the commit object file
        await fs.writeFile(this.headPath, commitHash); // Update the HEAD reference to point to the new commit
        await fs.writeFile(this.indexPath, JSON.stringify([])); // Clear the staging area (index) after committing
        console.log(`Commit successfully created: ${commitHash}`);
    }

    async getCurrentHead() {
        try {
            return await fs.readFile(this.headPath, { encoding: "utf-8" }); // Read the current HEAD reference
        } catch (error) {
            return null; // If HEAD file doesn't exist, return null
        }
    }

    async log() {
        let currentCommitHash = await this.getCurrentHead(); // Get the current HEAD reference
        while (currentCommitHash) {
            const commitData = JSON.parse(await fs.readFile(path.join(this.objectsPath, currentCommitHash), { encoding: "utf-8" })); // Read the commit data
            console.log("_____________________\n")
            console.log(`Commit: ${currentCommitHash}\nDate: ${commitData.timeStamp}\n\n${commitData.message}\n\n`);

            currentCommitHash = commitData.parent; // Move to the parent commit
        }
    }


    async showCommitDiff(commitHash) {
        const commitData = JSON.parse(await this.getCommitData(commitHash));
        if (!commitData) {
            console.log(`Commit ${commitHash} not found.`);
            return;
        }
        console.log(`Changes in the last commit are\n`);

        for (const file of commitData.files) {
            console.log(`File: ${file.path}`);
            const fileContent = await this.getFileContent(file.hash);
            console.log(fileContent);

            if (commitData.parent) {
                const parentCommitData = JSON.parse(await this.getCommitData(commitData.parent));
                const parentFileContent = await this.getParentFileContent(parentCommitData, file.path);

                if (parentFileContent !== undefined) {
                    console.log(`\nDiff:`);
                    const diff = diffLines(parentFileContent, fileContent);
                    diff.forEach(part => {
                        if (part.added) {
                            process.stdout.write(chalk.green("++ " + part.value));
                        } else if (part.removed) {
                            process.stdout.write(chalk.red("-- " + part.value));
                        } else {
                            process.stdout.write(chalk.grey(part.value));
                        }
                    });
                    console.log("");
                } else {
                    console.log(`New file in this commit`);
                }
            } else {
                console.log("First commit");
            }
        }
    }


    async getParentFileContent(parentCommitData, filePath) {
        const parentFile = parentCommitData.files.find(file => file.path === filePath); // Find the file in the parent commit
        if (parentFile) {
            return await this.getFileContent(parentFile.hash); // Get the content of the file from the object store
        }
    }

    async getCommitData(commithash) {
        const commitPath = path.join(this.objectsPath, commithash);
        try {
            return await fs.readFile(commitPath, { encoding: "utf-8" }); // Read the commit data
        } catch (error) {
            console.log(`Failed to read the commit data for ${commithash}:`, error);
            return null; // If commit file doesn't exist, return null
        }
    }


    async getFileContent(fileHash) {
        const objectPath = path.join(this.objectsPath, fileHash);
        return await fs.readFile(objectPath, { encoding: "utf-8" }); // Read the file content from the object store
    }

}

// (async () => {
//     const gyst = new Gyst(); // Create an instance of Gyst to initialize the repository
//     // await gyst.add("sample.txt")
//     // await gyst.add("sample2.txt")
//     // await gyst.commit("Fourth commit")

//     // await gyst.log(); // Log the commit history
//     await gyst.showCommitDiff("cd7e7d13a9da519900d94807d40052ec0f281df9");
// })()


program.command("init").action(async() => {
    const gyst = new Gyst(); // Create an instance of Gyst to initialize the repository
})

program.command("add <file>").action(async (file) => {
    const gyst = new Gyst(); // Create an instance of Gyst to work with the repository
    await gyst.add(file); // Add the specified file to the staging area
})

program.command("commit <message>").action(async (message) => {
    const gyst = new Gyst(); // Create an instance of Gyst to work with the repository
    await gyst.commit(message); // Commit the staged changes with the provided message
});

program.command("log").action(async () => {
    const gyst = new Gyst(); // Create an instance of Gyst to work with the repository
    await gyst.log(); // Log the commit history
});

program.command("show <commitHash>").action(async (commitHash) => {
    const gyst = new Gyst(); // Create an instance of Gyst to work with the repository
    await gyst.showCommitDiff(commitHash); // Show the differences for the specified commit
});

program.parse(process.argv); // Parse the command line arguments and execute the appropriate command