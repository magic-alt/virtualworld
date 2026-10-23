import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { release } from 'node:os';

/** cmd.exe receives one already-quoted command; libuv must not quote it a second time. */
export function batchInvocation(
  program,
  args,
  { platform = process.platform, env = process.env } = {},
) {
  if (platform !== 'win32') return { program: 'bash', args: [program, ...args], options: {} };
  const values = [program, ...args];
  if (values.some((value) => /["\r\n\0%!?^&|<>]/.test(value)))
    throw new Error(
      'Windows batch arguments contain unsupported shell metacharacters. Use a project/engine path without quotes, %, !, ^, &, |, < or >; spaces and Chinese characters are supported.',
    );
  return {
    program: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/v:off', '/c', `"${values.map((value) => `"${value}"`).join(' ')}"`],
    options: { windowsVerbatimArguments: true },
  };
}

/** Streams both channels while retaining original bytes and actual process status for each attempt. */
export function runLoggedProcess(invocation, record, overrides = {}) {
  const context = {
    platform: process.platform,
    env: process.env,
    spawn,
    probe: spawnSync,
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    ...overrides,
  };
  const startedAt = new Date().toISOString();
  const command = {
    kind: 'native-process-record',
    command: record.command,
    engine: {
      root: record.engine.root,
      version: record.engine.version,
      source: record.engine.source,
      buildVersion: record.engine.buildVersion,
    },
    machine: {
      platform: context.platform,
      architecture: process.arch,
      osRelease: release(),
      nodeVersion: process.versions.node,
    },
    inputs: record.inputs,
    nativeReportPath: record.nativeReportPath ?? null,
    program: invocation.program,
    args: invocation.args,
    cwd: record.projectRoot,
    startedAt,
    timeoutSeconds: record.timeoutSeconds ?? null,
    logDirectory: record.logDirectory,
  };
  writeFileSync(
    join(record.logDirectory, 'command.json'),
    `${JSON.stringify(command, null, 2)}\n`,
    { flag: 'wx' },
  );
  const stdout = openSync(join(record.logDirectory, 'stdout.log'), 'wx');
  const stderr = openSync(join(record.logDirectory, 'stderr.log'), 'wx');
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let failure;
    let timedOut = false;
    let interrupted;
    let finished = false;
    const stop = (signal) => {
      if (!child?.pid) return;
      try {
        if (context.platform === 'win32') {
          const terminated = context.probe(
            join(context.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { encoding: 'utf8', windowsHide: true, timeout: 10000, shell: false },
          );
          if (terminated.error || terminated.status !== 0) child.kill('SIGKILL');
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        child.kill('SIGKILL');
      }
      interrupted = signal;
    };
    const onInterrupt = () => stop('SIGINT');
    const onTerminate = () => stop('SIGTERM');
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      closeSync(stdout);
      closeSync(stderr);
      const successful = !failure && !timedOut && !interrupted && code === 0;
      const result = {
        ...command,
        finishedAt: new Date().toISOString(),
        exitCode: Number.isInteger(code) && code >= 0 ? code : null,
        signal: signal || interrupted || null,
        status: successful ? 'completed' : 'failed',
        timedOut,
        ...(failure ? { error: failure.message, errorCode: failure.code } : {}),
      };
      writeFileSync(
        join(record.logDirectory, 'process.json'),
        `${JSON.stringify(result, null, 2)}\n`,
        { flag: 'wx' },
      );
      if (successful) resolve({ ...result, commandCompleted: true });
      else {
        const detail = timedOut
          ? `timed out after ${record.timeoutSeconds}s`
          : interrupted
            ? `interrupted by ${interrupted}`
            : failure
              ? failure.message
              : `exited ${code ?? signal}`;
        const error = new Error(
          `${record.command} ${detail}. Logs: ${record.logDirectory}. No native acceptance pass is recorded.`,
        );
        error.exitCode = timedOut
          ? 124
          : interrupted === 'SIGINT'
            ? 130
            : Number.isInteger(code) && code > 0
              ? code
              : 1;
        error.logDirectory = record.logDirectory;
        reject(error);
      }
    };
    try {
      child = context.spawn(invocation.program, invocation.args, {
        cwd: record.projectRoot,
        env: context.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: context.platform !== 'win32',
        ...invocation.options,
      });
      child.stdout.on('data', (chunk) => {
        writeSync(stdout, chunk);
        context.stdout(chunk);
      });
      child.stderr.on('data', (chunk) => {
        writeSync(stderr, chunk);
        context.stderr(chunk);
      });
      child.on('error', (error) => {
        failure = error;
      });
      child.on('close', finish);
      process.on('SIGINT', onInterrupt);
      process.on('SIGTERM', onTerminate);
      if (record.timeoutSeconds)
        timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, record.timeoutSeconds * 1000);
    } catch (error) {
      failure = error;
      finish(null, null);
    }
  });
}
