import { OFile, OIf, OSignalBase, OSignal, OArchitecture, OEntity, OPort, OInstantiation, OWrite, ORead, OFileWithEntity, OFileWithPackage, OFileWithEntityAndArchitecture, ORecord, OPackage, ParserError, OEnum, OGenericActual, OMapping, OPortMap, MagicCommentType, OProcess, OToken, OMappingName, OMap, OMentionable, OGenericMap, OProcedureCall } from './parser/objects';
import { Parser } from './parser/parser';
import { ProjectParser } from './project-parser';
import { findBestMatch } from 'string-similarity';
import { EventEmitter } from 'events';
import {
  Range,
  Position,
  CodeAction,
  Diagnostic,
  TextEdit,
  CodeActionKind,
  DiagnosticSeverity,
  CodeLens,
  Command
} from 'vscode-languageserver';
export enum LinterRules {
  Reset
}
export interface IAddSignalCommandArguments {
  textDocumentUri: string;
  signalName: string;
  range: Range;
}
export type diagnosticCodeActionCallback = (textDocumentUri: string) => CodeAction[];
export type commandCallback = (textDocumentUri: string, ...args: any[]) => TextEdit[];
export class VhdlLinter {
  messages: Diagnostic[] = [];
  tree: OFileWithEntityAndArchitecture | OFileWithEntity | OFileWithPackage | OFile;
  parser: Parser;
  packages: OPackage[] = [];
  constructor(private editorPath: string, public text: string, public projectParser: ProjectParser, public onlyEntity: boolean = false) {
    //     console.log('lint');
    this.parser = new Parser(this.text, this.editorPath, onlyEntity);
    //     console.log(`parsing: ${editorPath}`);
    try {
      this.tree = this.parser.parse();
    } catch (e) {
      if (e instanceof ParserError) {
        let code;
        if (e.solution) {
          code = this.addCodeActionCallback((textDocumentUri: string) => {
            const actions = [];
            actions.push(CodeAction.create(
              e.solution.message,
              {
                changes: {
                  [textDocumentUri]: e.solution.edits
                }
              },
              CodeActionKind.QuickFix));
            return actions;
          });
        }

        this.messages.push({
          range: e.range,
          severity: DiagnosticSeverity.Error,
          message: e.message,
          code
        });
      } else {
        throw e;
      }
    }
    //     console.log(`done parsing: ${editorPath}`);

  }

  diagnosticCodeActionRegistry: diagnosticCodeActionCallback[] = [];
  addCodeActionCallback(handler: diagnosticCodeActionCallback): number {
    return this.diagnosticCodeActionRegistry.push(handler) - 1;
  }
  commandCallbackRegistry: commandCallback[] = [];
  addCommandCallback(title: string, textDocumentUri: string, handler: commandCallback): Command {
    const counter = this.commandCallbackRegistry.push(handler) - 1;
    return {
      title,
      command: 'vhdl-linter:lsp-command',
      arguments: [textDocumentUri, counter]
    };
  }
  checkMagicComments(range: Range, rule?: LinterRules, parameter?: string) {
    const matchingMagiComments = this.tree.magicComments.filter(magicComment => (magicComment.range.start.character <= range.start.character && magicComment.range.start.line <= range.start.line &&
      magicComment.range.end.character >= range.start.character && magicComment.range.end.line >= range.start.line) || (magicComment.range.start.character <= range.end.character && magicComment.range.start.line <= range.end.line &&
        magicComment.range.end.character >= range.end.character && magicComment.range.end.line >= range.end.line)).filter(magicComment => {
          if (magicComment.commentType === MagicCommentType.Disable) {
            return true;
          }
          if (magicComment.commentType === MagicCommentType.Parameter && rule === LinterRules.Reset && typeof parameter !== 'undefined' && magicComment.parameter.find(parameterFind => parameterFind.toLowerCase() === parameter.toLowerCase())) {
            return true;
          }
          return false;
        });
    return matchingMagiComments.length === 0;
  }
  checkTodos() {
    this.tree.magicComments.forEach(magicComment => {
      if (magicComment.commentType === MagicCommentType.Todo) {
        this.messages.push({
          range: magicComment.range,
          severity: DiagnosticSeverity.Information,
          message: magicComment.message
        });
      }
    });
  }

  addMessage(diagnostic: Diagnostic, rule: LinterRules, parameter: string): void;
  addMessage(diagnostic: Diagnostic): void;
  addMessage(diagnostic: Diagnostic, rule?: LinterRules, parameter?: string) {

    if (this.checkMagicComments(diagnostic.range, rule, parameter)) {
      this.messages.push(diagnostic);
    }

  }
  async parsePackages() {
    const packages = this.projectParser.getPackages();
    const standard = packages.find(pkg => pkg.name.toLowerCase() === 'standard');
    if (standard) {
      this.packages.push(standard);
    }
    //     console.log(packages);
    for (const useStatement of this.tree.useStatements) {
      let match = useStatement.text.match(/([^.]+)\.([^.]+)\.all/i);
      let found = false;
      if (match) {
        const library = match[1];
        const pkg = match[2];
        if (library.toLowerCase() === 'altera_mf') {
          found = true;
        } else {
          for (const foundPkg of packages) {
            if (foundPkg.name.toLowerCase() === pkg.toLowerCase()) {
              this.packages.push(foundPkg);
              found = true;
            }
          }
        }
      }
      if (!found) {
        this.addMessage({
          range: useStatement.range,
          severity: DiagnosticSeverity.Warning,
          message: `could not find package for ${useStatement.text}`
        });
      }
    }
    for (const read of this.tree.objectList.filter(object => object instanceof ORead && typeof object.definition === 'undefined') as ORead[]) {
      for (const pkg of packages) {
        for (const constant of pkg.constants) {
          if (constant.name.text.toLowerCase() === read.text.toLowerCase()) {
            read.definition = constant;
          }
        }
        for (const func of pkg.functions) {
          if (func.name.text.toLowerCase() === read.text.toLowerCase()) {
            read.definition = func;
          }
        }
        for (const type of pkg.types) {
          const typeRead = type.findRead(read);
          if (typeRead !== false) {
            read.definition = typeRead;
          }
          if (type instanceof OEnum) {
            for (const state of type.states) {
              if (state.name.text.toLowerCase() === read.text.toLowerCase()) {
                read.definition = state;

              }
            }
          } else if (type instanceof ORecord) {
            for (const child of type.children) {
              if (child.name.text.toLowerCase() === read.text.toLowerCase()) {
                read.definition = child;
              }
            }
          }
        }
      }
    }
    for (const instantiation of this.tree.objectList.filter(object => object instanceof OInstantiation && typeof object.definition === 'undefined') as OInstantiation[]) {
      instantiation.definition = this.getProjectEntity(instantiation);
    }
    for (const obj of this.tree.objectList) {
      if (obj instanceof OMapping) {
        if (obj.parent instanceof OGenericMap || obj.parent instanceof OPortMap) {
          const entity = this.getProjectEntity(obj.parent.parent);
          if (!entity) {
            continue;
          }
          const portOrGeneric = obj.parent instanceof OPortMap ? entity.ports.find(port => obj.name.find(name => name.text.toLowerCase() === port.name.text.toLowerCase())) :
            entity.generics.find(port => obj.name.find(name => name.text.toLowerCase() === port.name.text.toLowerCase()));

          if (!portOrGeneric) {
            continue;
          }
          obj.definition = portOrGeneric;
          for (const namePart of obj.name) {
            namePart.definition = portOrGeneric;
          }
          if (portOrGeneric instanceof OPort) {
            if (portOrGeneric.direction === 'in') {
              for (const mapping of obj.mappingIfOutput.flat()) {
                const index = this.tree.objectList.indexOf(mapping);
                this.tree.objectList.splice(index, 1);
                for (const mentionable of this.tree.objectList.filter(object => object instanceof OMentionable) as OMentionable[]) {
                  for (const [index, mention] of mentionable.mentions.entries()) {
                    if (mention === mapping) {
                      mentionable.mentions.splice(index, 1);
                    }
                  }
                }
              }
              obj.mappingIfOutput = [[], []];
            } else {
              for (const mapping of obj.mappingIfInput) {
                const index = this.tree.objectList.indexOf(mapping);
                this.tree.objectList.splice(index, 1);
                for (const mentionable of this.tree.objectList.filter(object => object instanceof OMentionable) as OMentionable[]) {
                  for (const [index, mention] of mentionable.mentions.entries()) {
                    if (mention === mapping) {
                      mentionable.mentions.splice(index, 1);
                    }
                  }
                }
              }
              obj.mappingIfInput = [];
            }

          }
        }
      }
    }
  }
  checkLibrary() {
    if (this.tree && this.tree instanceof OFileWithEntity && typeof this.tree.entity.library === 'undefined') {
      this.addMessage({
        range: Range.create(Position.create(0, 0), Position.create(1, 0)),
        severity: DiagnosticSeverity.Warning,
        message: `Please define library magic comment \n --!@library libraryName`
      });

    }
  }
  checkAll() {
    if (this.tree) {
      this.parsePackages();
      this.checkNotDeclared();
      this.checkLibrary();
      this.checkTodos();
      if (this.tree instanceof OFileWithEntityAndArchitecture) {
        this.checkResets();
        this.checkUnused(this.tree.architecture, this.tree.entity);
        this.checkDoubles();
        this.checkPortDeclaration();
        this.checkInstantiations(this.tree.architecture);
        this.checkProcedures(this.tree.architecture);
      }
      // this.parser.debugObject(this.tree);
    }
    return this.messages;
  }
  checkDoubles() {
    if (!(this.tree instanceof OFileWithEntityAndArchitecture)) {
      return;
    }
    for (const signal of this.tree.architecture.signals) {
      if (this.tree.architecture.signals.find(signalSearch => signal !== signalSearch && signal.name.text.toLowerCase() === signalSearch.name.text.toLowerCase())) {
        this.addMessage({
          range: signal.range,
          severity: DiagnosticSeverity.Error,
          message: `signal ${signal.name} defined multiple times`
        });
      }
    }
    for (const type of this.tree.architecture.types) {
      if (this.tree.architecture.types.find(typeSearch => type !== typeSearch && type.name.text.toLowerCase() === typeSearch.name.text.toLowerCase())) {
        this.addMessage({
          range: type.range,
          severity: DiagnosticSeverity.Error,
          message: `type ${type.name} defined multiple times`
        });
      }
      if (type instanceof OEnum) {
        for (const state of type.states) {
          if (type.states.find(stateSearch => state !== stateSearch && state.name.text.toLowerCase() === stateSearch.name.text.toLowerCase())) {
            this.addMessage({
              range: state.range,
              severity: DiagnosticSeverity.Error,
              message: `state ${state.name} defined multiple times`
            });

          }
        }
      }
    }
    for (const port of this.tree.entity.ports) {
      if (this.tree.entity.ports.find(portSearch => port !== portSearch && port.name.text.toLowerCase() === portSearch.name.text.toLowerCase())) {
        this.addMessage({
          range: port.range,
          severity: DiagnosticSeverity.Error,
          message: `port ${port.name} defined multiple times`
        });

      }
    }
  }

  private pushWriteError(write: OWrite) {
    const code = this.addCodeActionCallback((textDocumentUri: string) => {
      const actions = [];
      if (this.tree instanceof OFileWithEntityAndArchitecture) {
        const args: IAddSignalCommandArguments = { textDocumentUri, signalName: write.text, range: this.tree.architecture.range };
        actions.push(CodeAction.create('add signal to architecture', Command.create('add signal to architecture', 'vhdl-linter:add-signal', args)));
      }
      return actions;
    });
    this.addMessage({
      code,
      range: write.range,
      severity: DiagnosticSeverity.Error,
      message: `signal '${write.text}' is written but not declared`
    });
  }
  private pushReadError(read: ORead) {
    const code = this.addCodeActionCallback((textDocumentUri: string) => {
      const actions = [];
      for (const pkg of this.projectParser.getPackages()) {
        const thing = pkg.constants.find(constant => constant.name.text.toLowerCase() === read.text.toLowerCase()) || pkg.types.find(type => type.name.text.toLowerCase() === read.text.toLowerCase())
          || pkg.functions.find(func => func.name.text.toLowerCase() === read.text.toLowerCase());
        if (thing) {
          const file = read.getRoot();
          const pos = Position.create(0, 0);
          if (file.useStatements.length > 0) {
            pos.line = file.useStatements[file.useStatements.length - 1].range.end.line + 1;
          }
          actions.push(CodeAction.create(
            'add use statement for ' + pkg.name,
            {
              changes: {
                [textDocumentUri]: [TextEdit.insert(pos, `use ${pkg.library ? pkg.library : 'work'}.${pkg.name}.all;\n`)]
              }
            },
            CodeActionKind.QuickFix
          ));
        }
      }
      if (this.tree instanceof OFileWithEntityAndArchitecture) {
        const args: IAddSignalCommandArguments = { textDocumentUri, signalName: read.text, range: this.tree.architecture.range };
        actions.push(CodeAction.create('add signal to architecture', Command.create('add signal to architecture', 'vhdl-linter:add-signal', args)));
      }
      return actions;
    });
    this.addMessage({
      range: read.range,
      code: code,
      severity: DiagnosticSeverity.Error,
      message: `signal '${read.text}' is read but not declared`
    });
  }
  checkNotDeclared() {
    for (const obj of this.tree.objectList) {
      if (obj instanceof ORead && typeof obj.definition === 'undefined') {
        this.pushReadError(obj);
      } else if (obj instanceof OWrite && typeof obj.definition === 'undefined') {
        this.pushWriteError(obj);
      } else if (obj instanceof OMappingName && typeof obj.definition === 'undefined') {
        this.pushReadError(obj);
      }
    }
  }
  getCodeLens(textDocumentUri: string): CodeLens[] {
    if (!(this.tree instanceof OFileWithEntityAndArchitecture)) {
      return [];
    }
    const architecture = this.tree.architecture;
    let signalLike: OSignalBase[] = this.tree.architecture.signals;
    signalLike = signalLike.concat(this.tree.entity.ports);
    const processes = this.tree.objectList.filter(object => object instanceof OProcess) as OProcess[];
    const signalsMissingReset = signalLike.filter(signal => {
      if (signal.isRegister() === false) {
        return false;
      }
      for (const process of processes) {
        if (process.isRegisterProcess()) {
          for (const reset of process.getResets()) {
            if (reset.toLowerCase() === signal.name.text.toLowerCase()) {
              return false;
            }
          }
        }
      }
      const registerProcess = signal.getRegisterProcess();
      if (!registerProcess) {
        return false;
      }
      return this.checkMagicComments(registerProcess.range, LinterRules.Reset, signal.name.text);
    });
    if (signalsMissingReset.length === 0) {
      return [];
    }
    const registerProcessMap = new Map<OProcess, OSignalBase[]>();
    for (const signal of signalsMissingReset) {
      const registerProcess = signal.getRegisterProcess();
      if (!registerProcess) {
        continue;
      }
      let registerProcessList = registerProcessMap.get(registerProcess);
      if (!registerProcessList) {
        registerProcessList = [];
        registerProcessMap.set(registerProcess, registerProcessList);
      }
      registerProcessList.push(signal);
    }
    const codeLenses: CodeLens[] = [];
    for (const [registerProcess, signalLikes] of registerProcessMap.entries()) {
      const registerNameList = signalLikes.map(signalLike => signalLike.name.text).join(' ');
      codeLenses.push({
        range: registerProcess.range,
        command: this.addCommandCallback('Ignore all missing resets in process ' + registerProcess.label, textDocumentUri, () => {
          const change = this.tree.originalText.split('\n')[registerProcess.range.start.line - 1].match(/--\s*vhdl-linter-parameter-next-line/i) === null ?
            TextEdit.insert(registerProcess.range.start, `--vhdl-linter-parameter-next-line ${registerNameList}\n` + ' '.repeat(registerProcess.range.start.character)) :
            TextEdit.insert(Position.create(registerProcess.range.start.line - 1, this.tree.originalText.split('\n')[registerProcess.range.start.line - 1].length), ` ${registerNameList}`);
          return [change];
        })
        // {
        //   changes: {
        //     [textDocumentUri]: [change]
        //   }
        // },
        // CodeActionKind.QuickFix
      });
    }
    return codeLenses;

  }
  checkResets() {
    if (!(this.tree instanceof OFileWithEntityAndArchitecture)) {
      return;
    }
    let signalLike: OSignalBase[] = this.tree.architecture.signals;
    signalLike = signalLike.concat(this.tree.entity.ports);
    const processes = this.tree.objectList.filter(object => object instanceof OProcess) as OProcess[];

    for (const signal of signalLike) {
      if (signal.isRegister() === false) {
        continue;
      }
      let resetFound = false;
      for (const process of processes) {
        if (process.isRegisterProcess()) {
          for (const reset of process.getResets()) {
            if (reset.toLowerCase() === signal.name.text.toLowerCase()) {
              resetFound = true;
            }
          }
        }
      }
      const registerProcess = signal.getRegisterProcess();
      if (!resetFound && registerProcess) {
        const code = this.addCodeActionCallback((textDocumentUri: string) => {
          const actions = [];
          for (const statement of registerProcess.statements) {
            if (statement instanceof OIf) {
              for (const clause of statement.clauses) {
                if (clause.condition.match(/res|rst/i)) {
                  const change = this.tree.originalText.split('\n')[registerProcess.range.start.line - 1].match(/--\s*vhdl-linter-parameter-next-line/i) === null ?
                    TextEdit.insert(registerProcess.range.start, `--vhdl-linter-parameter-next-line ${signal.name.text}\n` + ' '.repeat(registerProcess.range.start.character)) :
                    TextEdit.insert(Position.create(registerProcess.range.start.line - 1, this.tree.originalText.split('\n')[registerProcess.range.start.line - 1].length), ` ${signal.name.text}`);
                  actions.push(CodeAction.create(
                    'Ignore reset for ' + signal.name,
                    {
                      changes: {
                        [textDocumentUri]: [change]
                      }
                    },
                    CodeActionKind.QuickFix
                  ));
                  let resetValue = null;
                  if (signal.type.map(read => read.text).join(' ').match(/^std_u?logic_vector|unsigned|signed/i)) {
                    resetValue = `(others => '0')`;
                  } else if (signal.type.map(read => read.text).join(' ').match(/^std_u?logic/i)) {
                    resetValue = `'0'`;
                  } else if (signal.type.map(read => read.text).join(' ').match(/^integer|natural|positive/i)) {
                    resetValue = `0`;
                  }
                  if (resetValue !== null) {
                    let positionStart = Position.create(clause.range.start.line, clause.range.start.character);
                    positionStart.line++;
                    const indent = positionStart.character + 2;
                    positionStart.character = 0;
                    actions.push(CodeAction.create(
                      'Add reset for ' + signal.name,
                      {
                        changes: {
                          [textDocumentUri]: [TextEdit.insert(positionStart, ' '.repeat(indent) + `${signal.name} <= ${resetValue};\n`)]
                        }
                      },
                      CodeActionKind.QuickFix
                    ));
                  }
                }
              }
            }
          }
          return actions;
        });
        const endCharacter = this.text.split('\n')[registerProcess.range.start.line].length;
        const range = Range.create(Position.create(registerProcess.range.start.line, 0), Position.create(registerProcess.range.start.line, endCharacter));
        const message = `Reset '${signal.name}' missing`;
        this.addMessage({
          range,
          code,
          severity: DiagnosticSeverity.Error,
          message
        }, LinterRules.Reset, signal.name.text);
      }
    }
  }

  private checkUnused(architecture: OArchitecture, entity?: OEntity) {
    if (!architecture) {
      return;
    }

    if (entity) {
      for (const port of entity.ports) {
        if (port.direction === 'in' && port.mentions.filter(token => token instanceof ORead).length === 0) {
          this.addMessage({
            range: port.range,
            severity: DiagnosticSeverity.Warning,
            message: `Not reading input port '${port.name}'`
          });
        }
        const writes = port.mentions.filter(token => token instanceof OWrite);
        if (port.direction === 'out' && writes.length === 0) {
          this.addMessage({
            range: port.range,
            severity: DiagnosticSeverity.Warning,
            message: `Not writing output port '${port.name}'`
          });
        }
      }
    }
    for (const signal of architecture.getRoot().objectList.filter(object => object instanceof OSignal) as OSignal[]) {
      if (signal.mentions.filter(token => token instanceof ORead).length === 0) {
        this.addMessage({
          range: signal.range,
          severity: DiagnosticSeverity.Warning,
          message: `Not reading signal '${signal.name}'`
        });
      }
      const writes = signal.mentions.filter(token => token instanceof OWrite);
      if (!signal.constant && writes.length === 0) {
        this.addMessage({
          range: signal.range,
          severity: DiagnosticSeverity.Warning,
          message: `Not writing signal '${signal.name}'`
        });
      }
      if (signal.constant) {
        for (const write of writes) {
          this.addMessage({
            range: write.range,
            severity: DiagnosticSeverity.Error,
            message: `Constant ${signal.name} cannot be written.`
          });
        }
      }
    }
  }
  checkPortDeclaration() {
    if (this.tree instanceof OFileWithEntity === false) {
      return;
    }
    const tree = this.tree as OFileWithEntity;
    for (const port of tree.entity.ports) {
      if (port.direction === 'in') {
        if (port.name.text.match(/^o_/i)) {
          const code = this.addCodeActionCallback((textDocumentUri: string) => {
            const actions = [];
            const newName = port.name.text.replace(/^o_/, 'i_');
            actions.push(CodeAction.create(
              `Replace portname with '${newName}`,
              {
                changes: {
                  [textDocumentUri]: [TextEdit.replace(port.name.range, newName)]
                }
              },
              CodeActionKind.QuickFix));
            const textEdit2: TextEdit = TextEdit.replace(port.directionRange, 'out');
            actions.push(CodeAction.create(
              `Change port direction to output.`,
              {
                changes: {
                  [textDocumentUri]: [TextEdit.replace(port.directionRange, 'out')]
                }
              },
              CodeActionKind.QuickFix));
            return actions;
          });
          this.addMessage({
            range: port.range,
            severity: DiagnosticSeverity.Error,
            message: `input port '${port.name}' begins with 'o_'!`,
            code
          });
        } else if (port.name.text.match(/^i_/i) === null) {
          const code = this.addCodeActionCallback((textDocumentUri: string) => {
            const actions = [];
            const newName = port.name.text.replace(/^(._|_?)/, 'i_');
            actions.push(CodeAction.create(
              `Replace portname with '${newName}`,
              {
                changes: {
                  [textDocumentUri]: [TextEdit.replace(port.name.range, newName)]
                }
              },
              CodeActionKind.QuickFix));
            return actions;
          });
          this.addMessage({
            range: port.range,
            severity: DiagnosticSeverity.Information,
            message: `input port '${port.name}' should begin with i_`,
            code
          });
        }
      } else if (port.direction === 'out') {
        if (port.name.text.match(/^i_/i)) {
          const code = this.addCodeActionCallback((textDocumentUri: string) => {
            const actions = [];
            const newName = port.name.text.replace(/^i_/, 'o_');
            actions.push(CodeAction.create(
              `Replace portname with '${newName}`,
              {
                changes: {
                  [textDocumentUri]: [TextEdit.replace(port.name.range, newName)]
                }
              },
              CodeActionKind.QuickFix));
            actions.push(CodeAction.create(
              `Change port direction to input.`,
              {
                changes: {
                  [textDocumentUri]: [TextEdit.replace(port.directionRange, 'in')]
                }
              },
              CodeActionKind.QuickFix));
            return actions;
          });
          this.addMessage({
            range: port.range,
            severity: DiagnosticSeverity.Error,
            message: `ouput port '${port.name}' begins with 'i_'!`,
            code
          });
        } else if (port.name.text.match(/^o_/i) === null) {
          const code = this.addCodeActionCallback((textDocumentUri: string) => {
            const actions = [];
            const newName = port.name.text.replace(/^(._|_?)/, 'o_');
            actions.push(CodeAction.create(
              `Replace portname with '${newName}`,
              {
                changes: {
                  [textDocumentUri]: [TextEdit.replace(port.name.range, newName)]
                }
              },
              CodeActionKind.QuickFix));
            return actions;
          });
          this.addMessage({
            range: port.range,
            severity: DiagnosticSeverity.Information,
            message: `ouput port '${port.name}' should begin with 'o_'`
          });
        }
      }
    }
  }
  getProjectEntity(instantiation: OInstantiation): OEntity | undefined {
    const projectEntities: OEntity[] = this.projectParser.getEntities();
    if (instantiation.library) {
      const entityWithLibrary = projectEntities.find(entity => entity.name.toLowerCase() === instantiation.componentName.toLowerCase() && typeof entity.library !== 'undefined' && typeof instantiation.library !== 'undefined' && entity.library.toLowerCase() === instantiation.library.toLowerCase());
      if (entityWithLibrary) {
        return entityWithLibrary;
      }
    }
    return projectEntities.find(entity => entity.name.toLowerCase() === instantiation.componentName.toLowerCase());

  }
  checkInstantiations(architecture: OArchitecture) {
    if (!architecture) {
      return;
    }
    for (const instantiation of architecture.instantiations) {
      if (instantiation.entityInstantiation) {
        const entity = this.getProjectEntity(instantiation);
        if (!entity) {
          this.addMessage({
            range: instantiation.range,
            severity: DiagnosticSeverity.Error,
            message: `can not find entity ${instantiation.componentName}`
          });
        } else {
          const foundPorts: OPort[] = [];
          if (instantiation.portMappings) {
            for (const portMapping of instantiation.portMappings.children) {
              const entityPort = entity.ports.find(port => {
                for (const part of portMapping.name) {
                  if (part.text.toLowerCase() === port.name.text.toLowerCase()) {
                    return true;
                  }
                }
                return false;
              });
              if (!entityPort) {
                const bestMatch = findBestMatch(portMapping.name[0].text, entity.ports.map(port => port.name.text));
                const code = this.addCodeActionCallback((textDocumentUri: string) => {
                  const actions = [];
                  actions.push(CodeAction.create(
                    `Replace with ${bestMatch.bestMatch.target} (score: ${bestMatch.bestMatch.rating})`,
                    {
                      changes: {
                        [textDocumentUri]: [TextEdit.replace(Range.create(portMapping.name[0].range.start, portMapping.name[portMapping.name.length - 1].range.end)
                          , bestMatch.bestMatch.target)]
                      }
                    },
                    CodeActionKind.QuickFix));
                  return actions;
                });
                this.addMessage({
                  range: portMapping.range,
                  severity: DiagnosticSeverity.Error,
                  message: `no port ${portMapping.name.map(name => name.text).join(', ')} on entity ${instantiation.componentName}`,
                  code
                });
              } else {
                foundPorts.push(entityPort);
              }
            }
          }
          for (const port of entity.ports) {
            if (port.direction === 'in' && typeof port.defaultValue === 'undefined' && typeof foundPorts.find(portSearch => portSearch === port) === 'undefined') {
              this.addMessage({
                range: instantiation.range,
                severity: DiagnosticSeverity.Error,
                message: `input port ${port.name} is missing in port map and has no default value on entity ${instantiation.componentName}`
              });
            }
          }

        }
      } else {
        this.addMessage({
          range: instantiation.range,
          severity: DiagnosticSeverity.Hint,
          message: `can not evaluate instantiation via component`
        });
      }
    }
    for (const generate of architecture.generates) {
      this.checkInstantiations(generate);
    }
  }
  checkProcedures(architecture: OArchitecture) {
    if (!architecture) {
      return;
    }
    for (const obj of architecture.getRoot().objectList) {
      if (obj instanceof OProcedureCall) {
        let searchObj = obj.parent;
        while (!(searchObj instanceof OFile)) {
          if (searchObj instanceof OArchitecture) {
            for (const procedureSearch of searchObj.procedures) {
              if (procedureSearch.name.text === obj.procedureName.text) {
                obj.definition = procedureSearch;
                break;
              }
            }
          }
          searchObj = searchObj.parent;
        }
        if (!obj.definition) {
          this.addMessage({
            range: obj.procedureName.range,
            severity: DiagnosticSeverity.Error,
            message: `procedure '${obj.procedureName.text}' is not declared`
          });

        } else {
          if (obj.portMap) {
            for (const [index, portMapping] of obj.portMap.children.entries()) {
              if (obj.definition.ports.length - 1 < index) {
                this.addMessage({
                  range: portMapping.range,
                  severity: DiagnosticSeverity.Error,
                  message: `Too many Ports in Procedure Instantiation`
                });
              } else {
                if (obj.definition.ports[index].direction === 'in') {

                  for (const mapping of portMapping.mappingIfOutput.flat()) {
                    const index = this.tree.objectList.indexOf(mapping);
                    this.tree.objectList.splice(index, 1);
                    for (const mentionable of this.tree.objectList.filter(object => object instanceof OMentionable) as OMentionable[]) {
                      for (const [index, mention] of mentionable.mentions.entries()) {
                        if (mention === mapping) {
                          mentionable.mentions.splice(index, 1);
                        }
                      }
                    }
                  }
                  portMapping.mappingIfOutput = [[], []];
                }
              }
            }
          }
          // for (const port of entity.ports) {
          //   if (port.direction === 'in' && typeof port.defaultValue === 'undefined' && typeof foundPorts.find(portSearch => portSearch === port) === 'undefined') {
          //     this.addMessage({
          //       range: instantiation.range,
          //       severity: DiagnosticSeverity.Error,
          //       message: `input port ${port.name} is missing in port map and has no default value on entity ${instantiation.componentName}`
          //     });
          //   }
          // }

        }
      }
    }
  }
  getIFromPosition(p: Position): number {
    let text = this.text.split('\n').slice(0, p.line);
    let i = text.join('\n').length + p.character;
    return i;
  }
}
// | {
//   title?: string,
//   priority?: number,
//   position: Range,
//   apply: (() => any),
// }
