import { convertStep } from './step-import';
const args = process.argv.slice(2);
if (Number(process.versions.node.split('.')[0]) < 24 || args.length !== 2) {
  process.stderr.write('Node.js 24+ required. Usage: step-import.cjs SOURCE OUTPUT_DIRECTORY\n');
  process.exitCode = 1;
} else {
  convertStep(args[0], args[1]).catch(() => {
    // Keep arbitrary model content and local filesystem diagnostics out of process logs.
    process.stderr.write(
      'STEP conversion failed: check file validity, size, complexity and output directory.\n',
    );
    process.exitCode = 1;
  });
}
