#!/usr/bin/env node
'use strict';

/**
 * design-cortex CLI — zero-dependency installer for the Design System KB Generator.
 *
 * Copies the skills + shared schemas/references into a target project's `.claude/`
 * directory and scaffolds a `.ds-kb-config.json` from the example. The skills are
 * plain markdown protocols with no runtime — this just puts the files where an
 * agent (Claude Code, Cursor, …) can find them.
 */

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');
const pkg = require(path.join(PKG_ROOT, 'package.json'));

const SKILL_NAMES = ['ds-extract', 'ds-write', 'ds-refresh', 'ds-validate'];

function log(msg) { process.stdout.write(msg + '\n'); }
function err(msg) { process.stderr.write(msg + '\n'); }

function help() {
  log(`design-cortex v${pkg.version}
${pkg.description}

Usage:
  npx design-cortex init [target-dir]   Install skills + shared/ into <target>/.claude/
                                        and scaffold .ds-kb-config.json (default: current dir)
  npx design-cortex --version           Print version
  npx design-cortex --help              Show this help

After 'init':
  1. Fill in <target>/.ds-kb-config.json (figma_mcp + figma_file_url are required).
  2. Connect your Figma MCP to that file.
  3. Ask your agent to "build my design system KB" (runs ds-extract → ds-write).

Docs: ${pkg.homepage}`);
}

function copyInto(src, dest, label) {
  if (!fs.existsSync(src)) throw new Error(`packaged source missing: ${src}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
  log(`  ✓ ${label} → ${dest}`);
}

function init(targetArg) {
  const target = path.resolve(targetArg || process.cwd());
  if (!fs.existsSync(target)) {
    throw new Error(`target directory does not exist: ${target}`);
  }

  const claudeDir = path.join(target, '.claude');
  log(`Installing Design Cortex into ${target}\n`);

  // 1. Skills → .claude/skills/<name> (overwrites our own skills, leaves others untouched)
  for (const name of SKILL_NAMES) {
    copyInto(
      path.join(PKG_ROOT, 'skills', name),
      path.join(claudeDir, 'skills', name),
      `skill ${name}`
    );
  }

  // 2. shared/ → .claude/shared (skills reference ../../shared and ../../../shared)
  copyInto(path.join(PKG_ROOT, 'shared'), path.join(claudeDir, 'shared'), 'shared schemas & references');

  // 3. Config scaffold at project root — never overwrite an existing one
  const cfgDest = path.join(target, '.ds-kb-config.json');
  const cfgExample = path.join(PKG_ROOT, '.ds-kb-config.json.example');
  if (fs.existsSync(cfgDest)) {
    log(`  • .ds-kb-config.json already exists — left untouched`);
  } else {
    fs.copyFileSync(cfgExample, cfgDest);
    log(`  ✓ config scaffold → ${cfgDest}`);
  }

  log(`\nDone. Next steps:
  1. Edit ${cfgDest} — set "figma_mcp" and "figma_file_url" (see SETUP.md).
  2. Connect your Figma MCP to that file.
  3. Tell your agent: "build my design system KB".`);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') return help();
  if (cmd === '--version' || cmd === '-v') return log(pkg.version);
  if (cmd === 'init') return init(args[1]);

  err(`Unknown command: ${cmd}\n`);
  help();
  process.exit(1);
}

try {
  main();
} catch (e) {
  err(`design-cortex: ${e.message}`);
  process.exit(1);
}
