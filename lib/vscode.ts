import * as path from 'path';
import { workspace, ExtensionContext, commands, window, env, Position } from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient';
import { copy, CopyTypes } from './vhdl-entity-converter';
import { VhdlLinter, IAddSignalCommandArguments } from './vhdl-linter';
import { ProjectParser } from './project-parser';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // The server is implemented in node
  let serverModule = require.resolve('./language-server');
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = { execArgv: ['--nolazy', '--inspect=6011', '--enable-source-maps'] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: 'file', language: 'vhdl' }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
    }
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    'VhdlLinter',
    'VhdlLinter',
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();
  context.subscriptions.push(commands.registerCommand('vhdl-linter:add-signal', async (args: IAddSignalCommandArguments) => {
    const editor = window.activeTextEditor;
    if (!editor) {
      return;
    }
    const length = await window.showInputBox({
      prompt: 'Give Length for ' + args.signalName,
      // validateInput: (value: string) => isNaN(parseInt(value, 10)) ? 'Not a Number' : ''
    });
    if (!length) {
      return;
    }
    editor.edit(editBuilder => {
      const type = parseInt(length, 10) === 1 ? 'std_ulogic' : `std_ulogic_vector(${ length } - 1 downto 0)`;
      editBuilder.insert(new Position(args.range.start.line + 1, 0), `  signal ${args.signalName} : ${type};\n`);
    });

  }));
  context.subscriptions.push(commands.registerCommand('vhdl-linter:copy-as-instance', () => copy(CopyTypes.Instance)));
  context.subscriptions.push(commands.registerCommand('vhdl-linter:copy-as-sysverilog', () => copy(CopyTypes.Sysverilog)));
  context.subscriptions.push(commands.registerCommand('vhdl-linter:copy-as-signals', () => copy(CopyTypes.Signals)));
  context.subscriptions.push(commands.registerCommand('vhdl-linter:copy-tree', () => {
    const editor = window.activeTextEditor;
    if (!editor) {
      return;
    }
    const vhdlLinter = new VhdlLinter(editor.document.uri.path, editor.document.getText(), new ProjectParser([]));
    if (vhdlLinter.tree) {
      env.clipboard.writeText(vhdlLinter.tree.getJSON());
      window.showInformationMessage(`VHDL file as JSON copied to clipboard`);

    }
  }));
  context.subscriptions.push(commands.registerCommand('vhdl-linter:copy-file-listing', async () => {
    const editor = window.activeTextEditor;
    if (!editor) {
      return;
    }
    const vhdlLinter = new VhdlLinter(editor.document.uri.path, editor.document.getText(), new ProjectParser([]));
    const result = await client.sendRequest('vhdl-linter/listing', { textDocument: {uri: editor.document.uri.toString()}});
    console.log('bb', result);
    env.clipboard.writeText(result as string);
    window.showInformationMessage(`copied`);
  }));
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}