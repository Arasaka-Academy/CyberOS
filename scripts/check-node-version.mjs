import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function assertMinimumNodeVersion(version, minimumVersion = "22.19.0") {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  const minimum = minimumVersion.split(".").map(Number);
  const actual = match?.slice(1).map(Number);
  const difference = actual?.map((part, index) => part - minimum[index]).find(part => part !== 0) ?? 0;
  if (!match || difference < 0) {
    throw new Error(`Node.js ${minimumVersion} or newer is required; found ${version}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const build = process.argv[2] === "--build";
    assertMinimumNodeVersion(process.argv[build ? 3 : 2] ?? process.versions.node, build ? "22.23.4" : "22.19.0");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
