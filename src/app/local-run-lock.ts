import {
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

export function acquireLocalRunLock(databasePath: string): () => void {
  const lockDirectory = `${databasePath}.lock`;

  try {
    mkdirSync(lockDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        "The review store is locked. Another CLI process may be running. " +
        "After a crash, verify that process has stopped before removing " +
        `the lock directory: ${lockDirectory}`,
      );
    }
    throw error;
  }

  try {
    writeFileSync(
      join(lockDirectory, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    rmSync(lockDirectory, { recursive: true, force: true });
    throw error;
  }

  let released = false;

  return () => {
    if (released) return;
    released = true;
    rmSync(lockDirectory, { recursive: true, force: true });
  };
}
