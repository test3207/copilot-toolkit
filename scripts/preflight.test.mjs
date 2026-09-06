import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const preflight = fileURLToPath(new URL('./preflight.mjs', import.meta.url));

for (const [version, accepted] of [['18.20.8', false], ['22.0.0', false], ['24.0.0', true]]) {
  test(`simulated Node ${version} preflight preserves the report and exit contract with stubbed CLIs`, context => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-preflight-test-'));
    context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const preload = path.join(temporary, 'simulated-node.cjs');
    fs.writeFileSync(preload, `
Object.defineProperty(process.versions, 'node', { value: '${version}' });
Object.defineProperty(process, 'version', { value: 'v${version}' });
const responses = {
  'git --version': 'git version 2.29.0',
  'gh --version': 'gh version fixture',
  'gh auth status': 'fixture authenticated',
};
require('node:child_process').execSync = command => {
  if (!Object.hasOwn(responses, command)) throw new Error('Unexpected external CLI: ' + command);
  return responses[command];
};
require('node:module').syncBuiltinESMExports();
`);
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !/^(NODE_OPTIONS$|GH_|GITHUB_)/i.test(key)));
    const result = spawnSync(process.execPath, [
      '--require', preload, preflight, '--platform', 'github', '--mcp-configured', 'false',
    ], {
      cwd: temporary, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(report), ['platform', 'deps', 'access', 'blocking', 'remediation']);
    assert.equal(report.platform, 'github');
    assert.deepEqual(report.deps, {
      node: { present: true, version: `v${version}`, ok: accepted },
      git: { present: true, ok: true, version: 'git version 2.29.0' },
      githubToken: false,
      gh: { present: true, authed: true },
    });
    assert.deepEqual(report.access, { recommended: 'cli', reasons: ['gh authenticated'] });
    assert.deepEqual(report.blocking, accepted ? [] : ['node']);
    assert.equal(result.status, accepted ? 0 : 2, result.stdout);
    if (accepted) {
      assert.deepEqual(report.remediation, []);
    } else {
      assert.equal(report.remediation.length, 1);
      assert.equal(report.remediation[0].dep, 'node');
      assert.equal(report.remediation[0].why, `Node v${version} is too old (need >= 24).`);
      assert.match(report.remediation[0].fix, /Node\.js 24\+.*supported LTS.*24 LTS.*https:\/\/nodejs\.org/);
    }
  });
}