import { OFile, OIf, OSignalLike, OSignal, OArchitecture, OEntity, OPort, OInstantiation, OWrite, ORead } from './parser/objects';
import { Range, Point } from 'atom';
import { Parser } from './parser/parser';
import { ProjectParser, OProjectEntity, OThing } from './project-parser';

export class VhdlLinter {
  messages: Message[] = [];
  tree: OFile;
  parser: Parser;
  packageThings: OThing[] = [];
  constructor(private editorPath: string, private text: string, public projectParser: ProjectParser) {
//     console.log('lint');
    this.parser = new Parser(this.text, this.editorPath);
//     console.log(`parsing: ${editorPath}`);
    try {
      this.tree = this.parser.parse();
    } catch (e) {
      try {
        let positionStart = this.getPositionFromI(e.i);
        let positionEnd = new Point(positionStart.row, Infinity);
        let position: Range = new Range(positionStart, positionEnd);
        this.messages.push({
          location: {
            file: this.editorPath,
            position
          },
          severity: 'error',
          excerpt: e.message
        });
      } catch (err) {
        console.error('error parsing error', e, err);
      }
    }
//     console.log(`done parsing: ${editorPath}`);

  }
  async parsePackages() {
    const packages = await this.projectParser.getPackages();
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
              this.packageThings.push(... foundPkg.things);
              if (foundPkg.referencePackage) {
                for (const referencePackage of packages) {
                  if (referencePackage.name === foundPkg.referencePackage) {
                    this.packageThings.push(... referencePackage.things);

                  }
                }
              }
              found = true;
            }
          }
        }
      }
      if (!found) {
        this.messages.push({
          location: {
            file: this.editorPath,
            position: this.getPositionFromILine(useStatement.begin, useStatement.end)
          },
          severity: 'warning',
          excerpt: `could not find package for ${useStatement.text}`
        });
      }
    }
  }
  async checkAll() {
    if (this.tree) {
      if (atom) {
        await this.parsePackages();
      }
      this.checkResets();
      await this.checkUnused(this.tree.architecture, this.tree.entity);
      this.checkDoubles();
      await this.checkNotDeclared(this.tree.architecture);
      this.checkPortDeclaration();
      await this.checkInstantiations(this.tree.architecture);
      // this.parser.debugObject(this.tree);
    }
    return this.messages;
  }
  checkDoubles() {
    if (!this.tree.architecture) {
      return;
    }
    for (const signal of this.tree.architecture.signals) {
      if (this.tree.architecture.signals.find(signalSearch => signal !== signalSearch && signal.name.toLowerCase() === signalSearch.name.toLowerCase())) {
        this.messages.push({
          location: {
            file: this.editorPath,
            position: this.getPositionFromILine(signal.startI)
          },
          severity: 'error',
          excerpt: `signal ${signal.name} defined multiple times`
        });
      }
    }
    for (const type of this.tree.architecture.types) {
      if (this.tree.architecture.types.find(typeSearch => type !== typeSearch && type.name.toLowerCase() === typeSearch.name.toLowerCase())) {
        this.messages.push({
          location: {
            file: this.editorPath,
            position: this.getPositionFromILine(type.startI)
          },
          severity: 'error',
          excerpt: `type ${type.name} defined multiple times`
        });
      }
      for (const state of type.states) {
        if (type.states.find(stateSearch => state !== stateSearch && state.name.toLowerCase() === stateSearch.name.toLowerCase())) {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(state.begin, state.end)
            },
            severity: 'error',
            excerpt: `state ${state.name} defined multiple times`
          });

        }
      }
    }
    for (const port of this.tree.entity.ports) {
      if (this.tree.entity.ports.find(portSearch => port  !== portSearch && port.name.toLowerCase() === portSearch.name.toLowerCase())) {
        this.messages.push({
          location: {
            file: this.editorPath,
            position: this.getPositionFromILine(port.startI)
          },
          severity: 'error',
          excerpt: `port ${port.name} defined multiple times`
        });

      }
    }
  }

  async checkNotDeclared(architecture?: OArchitecture) {
    if (!architecture) {
      return;
    }
    const pushWriteError = (write: OWrite) => {
      let positionStart = this.getPositionFromI(write.begin);
      let positionEnd = this.getPositionFromI(write.end);
      let position = new Range(positionStart, positionEnd);

      this.messages.push({
        location: {
          file: this.editorPath,
          position
        },
        severity: 'error',
        excerpt: `signal '${write.text}' is written but not declared`
      });
    };
    const pushReadError = (read: ORead) => {
      let positionStart = this.getPositionFromI(read.begin);
      let positionEnd = this.getPositionFromI(read.end);
      let position = new Range(positionStart, positionEnd);

      this.messages.push({
        location: {
          file: this.editorPath,
          position
        },
        severity: 'error',
        excerpt: `signal '${read.text}' is read but not declared`
      });
    };
    for (const process of architecture.processes) {
      for (const write of process.getFlatWrites()) {
        let found = this.tree.architecture.isValidWrite(write);
        if (!found) {
          for (const variable of process.variables) {
            if (variable.name.toLowerCase() === write.text.toLowerCase()) {
              found = true;
            }
          }
        }
        !found && pushWriteError(write);
      }
      for (const read of process.getFlatReads()) {
        let found = architecture.isValidRead(read, this.packageThings);
        for (const variable of process.variables) {
          if (variable.name.toLowerCase() === read.text.toLowerCase()) {
            found = true;
          }
        }
        !found && pushReadError(read);
      }
    }


    // Reads
    for (const instantiation of architecture.instantiations) {
      const entity = await this.getProjectEntity(instantiation);
      for (const read of instantiation.getFlatReads(entity)) {
        !architecture.isValidRead(read, this.packageThings) && pushReadError(read);
      }
    }
    // Writes

    for (const instantiation of architecture.instantiations) {
      const entity = await this.getProjectEntity(instantiation);
      for (const write of instantiation.getFlatWrites(entity)) {
        !architecture.isValidWrite(write) && pushWriteError(write);
      }
    }

    for (const assignment of architecture.assignments) {
      for (const read of assignment.reads) {
        !architecture.isValidRead(read, this.packageThings) && pushReadError(read);
      }
      for (const write of assignment.writes) {
        !architecture.isValidWrite(write) && pushWriteError(write);
      }
    }
    for (const generate of architecture.generates) {
      this.checkNotDeclared(generate);
    }
  }
  checkResets() {
    if (!this.tree.architecture) {
      return;
    }
    let signalLike: OSignalLike[] = this.tree.architecture.signals;
    signalLike = signalLike.concat(this.tree.entity.ports);
    for (const signal of signalLike) {
      if (signal.isRegister() === false) {
        continue;
      }
      let resetFound = false;
      for (const process of this.tree.architecture.processes) {
        if (process.isRegisterProcess()) {
          for (const reset of process.getResets()) {
            if (reset.toLowerCase() === signal.name.toLowerCase()) {
              resetFound = true;
            }
          }
        }
      }
      const registerProcess = signal.getRegisterProcess();
      if (!resetFound && registerProcess) {
        let resetBlockFound = false;
        const solutions: Solution[] = [];
        for (const statement of registerProcess.statements) {
          if (statement instanceof OIf) {
            for (const clause of statement.clauses) {
              if (clause.condition.match(/res/i)) {
                resetBlockFound = true;
                let resetValue = null;
                if (signal.type.match(/^std_u?logic_vector|unsigned|signed/i)) {
                  resetValue = `(others => '0')`;
                } else if (signal.type.match(/^std_u?logic/i)) {
                  resetValue = `'0'`;
                } else if (signal.type.match(/^integer|natural|positive/i)) {
                  resetValue = `0`;
                }
                if (resetValue !== null) {
                  let positionStart = this.getPositionFromI(clause.startI);
                  positionStart.row++;
                  solutions.push({
                    title: 'Add Register',
                    position:    new Range(positionStart, positionStart),
                    replaceWith: `  ${signal.name} <= ${resetValue};\n    `
                  });
                }
              }
            }
          }
        }
        const excerpt = resetBlockFound ? `Reset '${signal.name}' missing` : `Reset '${signal.name}' missing. Reset Block not found!`;
        this.messages.push({
          location: {
            file: this.editorPath,
            position: this.getPositionFromILine(registerProcess.startI)
          },
          solutions,
          severity: 'error',
          excerpt
        });
      }
    }
  }

  private async checkUnusedPerArchitecture(architecture: OArchitecture, signal: OSignal|OPort) {
    let unread = true;
    let unwritten = true;
    const sigLowName = signal.name.toLowerCase();
    for (const process of architecture.processes) {
      if (process.getFlatReads().find(read => read.text.toLowerCase() === sigLowName)) {
        unread = false;
      }
      if (process.getFlatWrites().find(write => write.text.toLowerCase() === sigLowName)) {
        unwritten = false;
      }
    }
    for (const assignment of architecture.assignments) {
      if (assignment.reads.find(read => read.text.toLowerCase() === sigLowName)) {
        unread = false;
      }
      if (assignment.writes.find(write => write.text.toLowerCase() === sigLowName)) {
        unwritten = false;
      }
    }
    for (const signal of architecture.signals) {
      if (signal.reads.find(read => read.text.toLowerCase() === sigLowName)) {
        unread = false;
      }
    }
    for (const instantiation of architecture.instantiations) {
      const entity = await this.getProjectEntity(instantiation);
      //       console.log(instantiation.getFlatReads(entity), instantiation.getFlatWrites(entity));
      if (instantiation.getFlatReads(entity).find(read => read.text.toLowerCase() === sigLowName)) {
        unread = false;
      }
      if (instantiation.getFlatWrites(entity).find(read => read.text.toLowerCase() === sigLowName)) {
        unwritten = false;
      }
    }
    for (const generate of architecture.generates) {
      const [unreadChild, unwrittenChild] = await this.checkUnusedPerArchitecture(generate, signal);
      if (!unreadChild) {
        unread = false;
      }
      if (!unwrittenChild) {
        unwritten = false;
      }
    }
    return [unread, unwritten];
  }
  private async checkUnused(architecture: OArchitecture, entity?: OEntity) {
    if (!architecture) {
      return;
    }
    for (const generate of architecture.generates) {
      this.checkUnused(generate);
    }
    if (entity) {
      for (const port of entity.ports) {
        const [unread, unwritten] = await this.checkUnusedPerArchitecture(architecture, port);
        if (unread && port.direction === 'in') {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(port.startI)
            },
            severity: 'warning',
            excerpt: `Not reading input port '${port.name}'`
          });
        }
        if (unwritten && port.direction === 'out') {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(port.startI)
            },
            severity: 'warning',
            excerpt: `Not writing output port '${port.name}'`
          });
        }
      }
    }
    for (const signal of architecture.signals) {
     const [unread, unwritten] = await this.checkUnusedPerArchitecture(architecture, signal);
     if (unread) {
       this.messages.push({
         location: {
           file: this.editorPath,
           position: this.getPositionFromILine(signal.startI)
         },
         severity: 'warning',
         excerpt: `Not reading signal '${signal.name}'`
       });
     }
     if (unwritten && !signal.constant) {
       this.messages.push({
         location: {
           file: this.editorPath,
           position: this.getPositionFromILine(signal.startI)
         },
         severity: 'warning',
         excerpt: `Not writing signal '${signal.name}'`
       });
     }
   }
  }
  checkPortDeclaration() {
    if (!this.tree.entity) {
      return;
    }
    for (const port of this.tree.entity.ports) {
      if (port.direction === 'in') {
        if (port.name.match(/^o_/i)) {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(port.startI)
            },
            severity: 'error',
            excerpt: `input port '${port.name}' begins with 'o_'!`
          });
        } else if (port.name.match(/^i_/i) === null) {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(port.startI)
            },
            severity: 'warning',
            excerpt: `input port '${port.name}' should begin with i_`
          });
        }
      } else if (port.direction === 'out') {
        if (port.name.match(/^i_/i)) {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(port.startI)
            },
            severity: 'error',
            excerpt: `ouput port '${port.name}' begins with 'i_'!`
          });
        } else if (port.name.match(/^o_/i) === null) {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(port.startI)
            },
            severity: 'warning',
            excerpt: `ouput port '${port.name}' should begin with 'o_'`
          });
        }
      }
    }
  }
  private async getProjectEntity(instantiation: OInstantiation): Promise<OProjectEntity|undefined> {
    const projectEntities: OProjectEntity[] = await this.projectParser.getEntities();
    if (instantiation.library) {
      const entityWithLibrary =  projectEntities.find(entity => entity.name.toLowerCase() === instantiation.componentName.toLowerCase() && typeof entity.library !== 'undefined' && typeof instantiation.library !== 'undefined' && entity.library.toLowerCase() === instantiation.library.toLowerCase());
      if (entityWithLibrary) {
        return entityWithLibrary;
      }
    }
    return projectEntities.find(entity => entity.name.toLowerCase() === instantiation.componentName.toLowerCase());

  }
  async checkInstantiations(architecture: OArchitecture) {
    if (!architecture) {
      return;
    }
    for (const instantiation of architecture.instantiations) {
      if (instantiation.entityInstantiation) {
        const entity = await this.getProjectEntity(instantiation);
        if (!entity) {
          this.messages.push({
            location: {
              file: this.editorPath,
              position: this.getPositionFromILine(instantiation.startI)
            },
            severity: 'error',
            excerpt: `can not find entity ${instantiation.componentName}`
          });
        } else {
          const foundPorts = [];
          for (const portMapping of instantiation.portMappings) {
            const entityPortIndex = entity.ports.findIndex(port => {
              for (const part of portMapping.name) {
                if (part.text.toLowerCase() === port.name.toLowerCase()) {
                  return true;
                }
              }
              return false;
            });
            const entityPort = entity.ports[entityPortIndex];
            foundPorts.push(entityPortIndex);
            if (!entityPort) {
              this.messages.push({
                location: {
                  file: this.editorPath,
                  position: this.getPositionFromILine(portMapping.startI)
                },
                severity: 'error',
                excerpt: `no port ${portMapping.name.map(name => name.text).join(', ')} on entity ${instantiation.componentName}`
              });
            }
          }
          for (const [index, port] of entity.ports.entries()) {
            if (port.direction === 'in' && port.hasDefault === false && foundPorts.findIndex(portIndex => portIndex === index) === -1) {
              this.messages.push({
                location: {
                  file: this.editorPath,
                  position: this.getPositionFromILine(instantiation.startI)
                },
                severity: 'error',
                excerpt: `input port ${port.name} is missing in port map and has no default value on entity ${instantiation.componentName}`
              });
            }
          }

        }
      } else {
        this.messages.push({
          location: {
            file: this.editorPath,
            position: this.getPositionFromILine(instantiation.startI)
          },
          severity: 'info',
          excerpt: `can not evaluate instantiation via component`
        });
      }
    }
    for (const generate of architecture.generates) {
      this.checkInstantiations(generate);
    }
  }




  getPositionFromILine(i: number, j?: number): Range {
    const positionStart = this.getPositionFromI(i);
    const positionEnd = j ? this.getPositionFromI(j) : new Point(positionStart.row, Infinity);
    const position: Range = new Range(positionStart, positionEnd);
    return position;
  }
  getPositionFromI(i: number): Point {
    let row = 0;
    let col = 0;
    for (let count = 0; count < i; count++) {
      if (this.text[count] === '\n') {
        row++;
        col = 0;
      } else {
        col++;
      }
    }
    return new Point(row, col);
  }

}
export type Message = {
  // From providers
  location: {
    file: string,
    position: Range,
  },
  reference?: {
    file: string,
    position?: Point,
  },
  url?: string,
  icon?: string,
  excerpt: string,
  severity: 'error' | 'warning' | 'info',
  solutions?: Solution[],
  description?: string | (() => Promise<string> | string)
};
export type Solution = {
  title?: string,
  position: Range,
  priority?: number,
  currentText?: string,
  replaceWith: string,
} | {
  title?: string,
  priority?: number,
  position: Range,
  apply: (() => any),
};
