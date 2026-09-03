// Runs with /usr/bin/osascript -l JavaScript, which ships with macOS.
// It is intentionally a tiny JSON merger rather than a Node program: this is
// part of the installed app's adapter path, where a developer checkout and a
// separately installed Node runtime cannot be assumed.

ObjC.import('Foundation');

const fileManager = $.NSFileManager.defaultManager;

function readJson(path) {
  const contents = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, undefined);
  if (contents.isNil()) return {};
  return JSON.parse(ObjC.unwrap(contents));
}

function writeJson(path, value) {
  const parent = $(path).stringByDeletingLastPathComponent;
  fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(parent, true, undefined, undefined);
  const text = $.NSString.stringWithString($(JSON.stringify(value, null, 2) + '\n'));
  if (!text.writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, undefined)) {
    throw new Error(`Could not write ${path}`);
  }
}

function removeClaudeCommand(groups, marker) {
  return groups
    .map((group) => ({
      ...group,
      hooks: Array.isArray(group.hooks)
        ? group.hooks.filter((hook) => !(typeof hook.command === 'string' && hook.command.includes(marker)))
        : group.hooks,
    }))
    .filter((group) => !Array.isArray(group.hooks) || group.hooks.length > 0);
}

function updateClaude(path, operation, marker, commands) {
  const settings = readJson(path);
  settings.hooks = settings.hooks || {};
  for (const [event, command] of Object.entries(commands)) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    settings.hooks[event] = removeClaudeCommand(groups, marker);
    if (operation === 'install') {
      settings.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 5 }] });
    }
  }
  writeJson(path, settings);
}

function updateCursor(path, operation, marker, commands) {
  const settings = readJson(path);
  settings.version = settings.version || 1;
  settings.hooks = settings.hooks || {};
  for (const [event, command] of Object.entries(commands)) {
    const hooks = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    settings.hooks[event] = hooks.filter(
      (hook) => !(typeof hook.command === 'string' && hook.command.includes(marker)),
    );
    if (operation === 'install') settings.hooks[event].push({ command });
  }
  writeJson(path, settings);
}

function run(argv) {
  const [target, operation, path, marker, ...commandPairs] = argv;
  if (!['claude-code', 'cursor'].includes(target) || !['install', 'uninstall'].includes(operation)) {
    throw new Error('Usage: merge-hooks.js <claude-code|cursor> <install|uninstall> <path> <marker> [event command]...');
  }
  if (commandPairs.length % 2 !== 0) throw new Error('Each event needs a command');
  const commands = {};
  for (let index = 0; index < commandPairs.length; index += 2) {
    commands[commandPairs[index]] = commandPairs[index + 1];
  }
  if (target === 'claude-code') updateClaude(path, operation, marker, commands);
  else updateCursor(path, operation, marker, commands);
}
