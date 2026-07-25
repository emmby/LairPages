import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the root directory of the Lair repository dependency.
 */
export function getBaseLairDir(): string {
  if (process.env.LAIR_DIR) {
    return process.env.LAIR_DIR;
  }
  const standardSibling = path.resolve(process.cwd(), '../Lair');
  if (fs.existsSync(standardSibling)) {
    return standardSibling;
  }
  const currentBranchName = path.basename(process.cwd());
  return path.resolve(process.cwd(), `../../Lair/${currentBranchName}`);
}

/**
 * Safely resolves the directory containing Lair map assets.
 * Checks client/assets/maps first (for monorepo layout), then falls back to assets/maps.
 * Verifies that the resolved path is an existing directory.
 */
export function getLairMapsDir(baseLairDir: string = getBaseLairDir()): string {
  const candidatePaths = [
    path.resolve(baseLairDir, 'client/assets/maps'),
    path.resolve(baseLairDir, 'assets/maps'),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      try {
        if (fs.statSync(candidatePath).isDirectory()) {
          return candidatePath;
        }
      } catch (_) {
        // Ignore errors and try next candidate
      }
    }
  }

  return candidatePaths[0];
}
