import { Range, Position, TextEdit } from 'vscode-languageserver';

export class OI implements Position {
  private i_: number;
  constructor(public parent: ObjectBase | OFile, i: number, j?: number) {
    if (typeof j === 'undefined') {
      this.i_ = i;
    } else {
      this.position = {
        line: i,
        character: j,
      };
      this.calcI();
    }
  }
  set i(i: number) {
    this.position = undefined;
    this.i_ = i;
  }
  get i() {
    return this.i_;
  }
  private position?: Position;
  get line() {
    if (!this.position) {
      this.position = this.calcPosition();
    }
    return this.position.line;
  }
  set line(line: number) {
    if (!this.position) {
      this.position = this.calcPosition();
    }
    this.position.line = line;
    this.calcI();
  }
  toJSON() {
    if (!this.position) {
      this.position = this.calcPosition();
    }
    return this.position;
  }
  get character() {
    if (!this.position) {
      this.position = this.calcPosition();
    }
    return this.position.character;
  }
  set character(character: number) {
    if (!this.position) {
      this.position = this.calcPosition();
    }
    this.position.character = character;
    this.calcI();
  }
  getRangeToEndLine(): OIRange {
    const start = this.i;
    const text = this.parent instanceof OFile ? this.parent.text : this.parent.getRoot().text;
    let end = text.length;
    const match = /\n/.exec(text.substr(start));
    if (match) {
      end = start + match.index;
    }
    return new OIRange(this.parent, start, end);

  }
  private calcPosition(): Position {
    const lines = (this.parent instanceof OFile ? this.parent : this.parent.getRoot()).text.slice(0, this.i).split('\n');
    const line = lines.length - 1;
    const character = lines[lines.length - 1].length;
    return { character, line };
  }
  private calcI() {
    if (typeof this.position === 'undefined') {
      throw new Error('Something went wrong with OIRange');
    }
    const lines = (this.parent instanceof OFile ? this.parent : this.parent.getRoot()).text.split('\n');
    this.i_ = lines.slice(0, this.position.line).join('\n').length + 1 + this.position.character;
  }
}
export class OIRange implements Range {
  public start: OI;
  public end: OI;
  constructor(public parent: ObjectBase | OFile, start: number | OI, end: number | OI) {
    if (start instanceof OI) {
      this.start = start;
    } else {
      this.start = new OI(parent, start);
    }
    if (end instanceof OI) {
      this.end = end;
    } else {
      this.end = new OI(parent, end);
    }
  }
  setEndBacktraceWhitespace(i: number) {
    this.end.i = i - 1;
    const text = this.parent instanceof OFile ? this.parent.text : this.parent.getRoot().text;
    while (text[this.end.i].match(/\s/)) {
      this.end.i--;
    }
  }
  toJSON() {
    return Range.create(this.start, this.end);
  }
}

export class ObjectBase {
  public range: OIRange;
  constructor(public parent: ObjectBase | OFile, startI: number, endI: number) {
    this.range = new OIRange(this, startI, endI);
    let p = parent;
    while (!(p instanceof OFile)) {
      p = p.parent;
    }
    p.objectList.push(this);
  }
  private root?: OFile;
  getRoot(): OFile {
    if (this.root) {
      return this.root;
    }
    let parent: any = this;
    while (parent instanceof OFile === false) {
      parent = parent.parent;
    }
    this.root = parent;
    return parent;
  }
}
export class OMentionable extends ObjectBase {
  name: OName;
  mentions: OToken[] = [];
}
export class ODefitionable extends ObjectBase {
  public definition?: OSignalBase | OGenericType | OType | OState | OFunction | OEntity;
}
export class OFile {
  constructor(public text: string, public file: string, public originalText: string) { }
  libraries: string[] = [];
  useStatements: OUseStatement[] = [];
  objectList: ObjectBase[] = [];
  magicComments: (OMagicCommentParameter | OMagicCommentDisable | OMagicCommentTodo)[] = [];
  getJSON() {
    const obj = {};
    const seen = new WeakSet();

    return JSON.stringify(this, (key, value) => {
      if (['parent', 'originalText', 'objectList', 'root'].indexOf(key) > -1) {
        return;
      }
      // text of file
      if (typeof value === 'string' && value.length > 1000) {
        return;
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return;
        }
        value.proto = value.constructor.name;
        seen.add(value);
      }
      return value;
    });
  }
}
export class OFileWithEntity extends OFile {
  entity: OEntity;
}
export class OFileWithEntityAndArchitecture extends OFileWithEntity {
  architecture: OArchitecture;
}
export class OFileWithPackage extends OFile {
  package: OPackage;
}
export class OPackage extends ObjectBase {
  name: string;
  functions: OFunction[] = [];
  procedures: OProcedure[] = [];
  constants: OSignal[] = [];
  types: OType[] = [];
  parent: OFile;
  library?: string;
}
export class OUseStatement extends ObjectBase {
  text: string;
  begin: number;
  end: number;
}
export class OFunction extends OMentionable {
  // name: string;
  parameter: string;
}
export class OProcedure extends OFunction {
  variables: OVariable[] = [];
  statements: OStatement[] = [];
  ports: OPort[] = [];

}
export class OArchitecture extends ObjectBase {
  signals: OSignal[] = [];
  types: OType[] = [];
  functions: OFunction[] = [];
  procedureInstantiations: OProcedureInstantiation[] = [];
  procedures: OProcedure[] = [];

  statements: (OProcess | OInstantiation | OForGenerate | OIfGenerate | OAssignment | OProcedureInstantiation)[] = [];
  get processes() {
    return this.statements.filter(statement => statement instanceof OProcess) as readonly OProcess[];
  }
  get instantiations() {
    return this.statements.filter(statement => statement instanceof OInstantiation) as readonly OInstantiation[];
  }
  get generates() {
    const generates = this.statements.filter(statement => statement instanceof OForGenerate) as OArchitecture[];
    for (const ifObj of this.statements.filter(statement => statement instanceof OIfGenerate) as OIfGenerate[]) {
      generates.push(...ifObj.ifGenerates);
      if (ifObj.elseGenerate) {
        generates.push(ifObj.elseGenerate);
      }
    }
    return generates as readonly (OArchitecture)[];
  }
  get assignments() {
    return this.statements.filter(statement => statement instanceof OAssignment) as readonly OAssignment[];
  }
  // processes: OProcess[] = [];
  // instantiations: OInstantiation[] = [];
  // generates: OArchitecture[] = [];
  // assignments: OAssignment[] = [];

}
export class OType extends OMentionable {
  name: OName;
  units?: string[];
  findRead(read: ORead) {
    if (this.name.text.toLowerCase() === read.text.toLowerCase()) {
      return this;
    }
    if (this.units) {
      for (const unit of this.units) {
        if (unit.toLowerCase() === read.text.toLowerCase()) {
          return this;
        }

      }
    }
    if (this instanceof OEnum) {
      for (const state of this.states) {
        if (state.name.text.toLowerCase() === read.text.toLowerCase()) {
          return state;
        }
      }
    } else if (this instanceof ORecord && read instanceof OElementRead) {
      for (const child of this.children) {
        if (child.name.text.toLowerCase() === read.text.toLowerCase()) {
          return child;
        }
      }
    }
    return false;
  }
}
export class OSubType extends OType {
  superType: ORead;
  reads: ORead[];
}
export class OEnum extends OType {
  states: OState[] = [];
}
export class ORecord extends OType {
  children: ORecordChild[];
}
export class ORecordChild extends OType {
  public parent: ORecord;
}
export class OState extends OMentionable {
  name: OName;
  public parent: OEnum;
}
export class OForGenerate extends OArchitecture {
  public variable: OVariable;
  constructor(public parent: OArchitecture,
    startI: number,
    endI: number,
    public start: string,
    public end: string,
  ) {
    super(parent, startI, endI);
  }
}
export class OIfGenerate extends ObjectBase {
  ifGenerates: OIfGenerateClause[] = [];
  elseGenerate: OElseGenerateClause;
}
export class OIfGenerateClause extends OArchitecture {
  conditions: string[];
  conditionReads: ORead[];
  public parent: OIfGenerate;
}
export class OElseGenerateClause extends OArchitecture {
  public parent: OIfGenerate;

}

export class OName extends ObjectBase {
  text: string;
  public parent: ObjectBase;
  toString() {
    return this.text;
  }
}
export abstract class OVariableBase extends OMentionable {
  type: ORead[];
  name: OName;
  defaultValue?: ORead[];
}
export abstract class OSignalBase extends OVariableBase {
  private register: boolean | null = null;
  private registerProcess: OProcess | null;
  constructor(public parent: OArchitecture | OEntity | OPackage | OProcess | OForLoop | OProcedure, startI: number, endI: number) {
    super(parent, startI, endI);
  }
  isRegister(): boolean {
    if (this.register !== null) {
      return this.register;
    }
    this.register = false;
    // const processes = this.parent instanceof OArchitecture ? this.parent.processes : (this.parent.parent instanceof OFileWithEntityAndArchitecture ? this.parent.parent.architecture.processes : []);
    const processes = this.getRoot().objectList.filter(object => object instanceof OProcess) as OProcess[];
    // TODO: Redeclaration of Signals
    for (const process of processes) {
      if (process.isRegisterProcess()) {
        for (const write of process.getFlatWrites()) {
          if (write.text.toLowerCase() === this.name.text.toLowerCase()) {
            this.register = true;
            this.registerProcess = process;
          }
        }
      }
    }
    return this.register;
  }
  getRegisterProcess(): OProcess | null {
    if (this.isRegister === null) {
      return null;
    }
    return this.registerProcess;
  }
}
export class OVariable extends OVariableBase {
  type: ORead[];
  constant: boolean;

}
export class OSignal extends OSignalBase {
  constant: boolean;
}
export class OMap extends ObjectBase {
  public children: OMapping[] = [];

}
export class OGenericMap extends OMap {
  constructor(public parent: OInstantiation, startI: number, endI: number) {
    super(parent, startI, endI);
  }
}
export class OPortMap extends OMap {
  constructor(public parent: OInstantiation, startI: number, endI: number) {
    super(parent, startI, endI);
  }
}
export class OInstantiation extends ODefitionable {
  label?: string;
  definition?: OEntity;
  componentName: string;
  portMappings?: OPortMap;
  genericMappings?: OGenericMap;
  library?: string;
  entityInstantiation: boolean;
  private flatReads: ORead[] | null = null;
  private flatWrites: OWrite[] | null = null;
  getFlatReads(entity: OEntity | undefined): ORead[] {
    //     console.log(entity, 'asd2');

    if (this.flatReads !== null) {
      return this.flatReads;
    }
    this.flatReads = [];
    if (this.portMappings) {
      for (const portMapping of this.portMappings.children) {
        if (entity) {
          const entityPort = entity.ports.find(port => {
            for (const part of portMapping.name) {
              if (part.text.toLowerCase() === port.name.text.toLowerCase()) {
                return true;
              }
            }
            return false;
          });
          if (entityPort && (entityPort.direction === 'in' || entityPort.direction === 'inout')) {
            this.flatReads.push(...portMapping.mappingIfInput);
          } else if (entityPort && entityPort.direction === 'out') {
            this.flatReads.push(...portMapping.mappingIfOutput[0]);
          }
        } else {
          this.flatReads.push(...portMapping.mappingIfInput);
        }
      }
    }
    if (this.genericMappings) {
      for (const portMapping of this.genericMappings.children) {
        this.flatReads.push(...portMapping.mappingIfInput);
      }
    }
    return this.flatReads;
  }
  getFlatWrites(entity: OEntity | undefined): OWrite[] {
    //     console.log(entity, 'asd');
    if (this.flatWrites !== null) {
      return this.flatWrites;
    }
    this.flatWrites = [];
    if (this.portMappings) {
      for (const portMapping of this.portMappings.children) {
        if (entity) {
          const entityPort = entity.ports.find(port => {
            for (const part of portMapping.name) {
              if (part.text.toLowerCase() === port.name.text.toLowerCase()) {
                return true;
              }
            }
            return false;
          });
          if (entityPort && (entityPort.direction === 'out' || entityPort.direction === 'inout')) {
            this.flatWrites.push(...portMapping.mappingIfOutput[1]);
          }
        } else {
          this.flatWrites.push(...portMapping.mappingIfInput);
        }
      }
    }
    return this.flatWrites;
  }
}
export class OProcedureCallPortMap extends OMap {
  constructor(public parent: OProcedureCall, startI: number, endI: number) {
    super(parent, startI, endI);
  }
}
export class OProcedureCall extends ODefitionable {
  procedureName: OName;
  definition?: OProcedure;
  portMap?: OProcedureCallPortMap;
}
export class OMapping extends ODefitionable {
  constructor(public parent: OMap, startI: number, endI: number) {
    super(parent, startI, endI);
  }
  name: OMappingName[];
  mappingIfInput: ORead[];
  mappingIfOutput: [ORead[], OWrite[]];
}
export class OEntity extends ObjectBase {
  constructor(public parent: OFileWithEntity, startI: number, endI: number, public library?: string) {
    super(parent, startI, endI);
  }
  name: string;
  portRange?: OIRange;
  genericRange?: OIRange;
  ports: OPort[] = [];
  generics: OGeneric[] = [];
  signals: OSignal[] = [];
  functions: OFunction[] = [];
  procedures: OProcedure[] = [];
  types: OType[] = [];
  statements: (OProcess | OAssignment | OProcedureInstantiation)[] = [];


}
export class OPort extends OSignalBase {
  direction: 'in' | 'out' | 'inout';
  directionRange: OIRange;
}
export class OGenericType extends OMentionable {
  name: OName;
}
export class OGenericActual extends OVariableBase {
  name: OName;
  type: ORead[];
  defaultValue?: ORead[];
  reads: ORead[];
}
export type OGeneric = OGenericType | OGenericActual;
export type OStatement = OCase | OAssignment | OIf | OForLoop | OWhileLoop | OProcedureCall;
export class OIf extends ObjectBase {
  clauses: OIfClause[] = [];
  else?: OElseClause;
}
export class OWhileLoop extends ObjectBase {
  conditionReads: ORead[];
  statements: OStatement[] = [];
}
export class OElseClause extends ObjectBase {
  statements: OStatement[] = [];
}
export class OIfClause extends ObjectBase {
  condition: string;
  conditionReads: ORead[];
  statements: OStatement[] = [];
}
export class OCase extends ObjectBase {
  variable: ORead[];
  whenClauses: OWhenClause[] = [];
}
export class OWhenClause extends ObjectBase {
  condition: ORead[];
  statements: OStatement[] = [];
}
export class OProcess extends ObjectBase {
  statements: OStatement[] = [];
  sensitivityList: string;
  label?: string;
  variables: OVariable[] = [];
  private registerProcess: boolean | null = null;
  isRegisterProcess(): boolean {
    if (this.registerProcess !== null) {
      return this.registerProcess;
    }

    this.registerProcess = false;
    for (const statement of this.statements) {
      if (statement instanceof OIf) {
        for (const clause of statement.clauses) {
          if (clause.condition.match(/rising_edge/i)) {
            this.registerProcess = true;
          }
        }
      }
    }
    return this.registerProcess;
  }
  private flatWrites: OWrite[] | null = null;
  getFlatWrites(): OWrite[] {
    if (this.flatWrites !== null) {
      return this.flatWrites;
    }
    const flatten = (objects: OStatement[]) => {
      const flatWrites: OWrite[] = [];
      for (const object of objects) {
        if (object instanceof OAssignment) {
          flatWrites.push(...object.writes);
        } else if (object instanceof OIf) {
          if (object.else) {
            flatWrites.push(...flatten(object.else.statements));
          }
          for (const clause of object.clauses) {
            flatWrites.push(...flatten(clause.statements));
          }
        } else if (object instanceof OCase) {
          for (const whenClause of object.whenClauses) {
            flatWrites.push(...flatten(whenClause.statements));
          }
        } else if (object instanceof OForLoop || object instanceof OWhileLoop) {
          flatWrites.push(...flatten(object.statements));
        } else if (object instanceof OProcedureCall) {
          // TODO
        } else {
          throw new Error('UUPS');
        }


      }
      return flatWrites;
    };
    this.flatWrites = flatten(this.statements);
    return this.flatWrites;
  }
  private flatReads: ORead[] | null = null;
  getFlatReads(): ORead[] {
    if (this.flatReads !== null) {
      return this.flatReads;
    }
    const flatten = (objects: OStatement[]) => {
      const flatReads: ORead[] = [];
      for (const object of objects) {
        if (object instanceof OAssignment) {
          flatReads.push(...object.reads);
        } else if (object instanceof OIf) {
          if (object.else) {
            flatReads.push(...flatten(object.else.statements));
          }
          for (const clause of object.clauses) {
            flatReads.push(...clause.conditionReads);
            flatReads.push(...flatten(clause.statements));
          }
        } else if (object instanceof OCase) {
          flatReads.push(...object.variable);
          for (const whenClause of object.whenClauses) {
            flatReads.push(...whenClause.condition);
            flatReads.push(...flatten(whenClause.statements));
          }
        } else if (object instanceof OForLoop) {
          flatReads.push(...flatten(object.statements));
        } else if (object instanceof OWhileLoop) {
          flatReads.push(...flatten(object.statements));
          flatReads.push(...object.conditionReads);
        } else if (object instanceof OProcedureCall) {
          // TODO
        } else {
          throw new Error('UUPS');
        }


      }
      return flatReads;
    };
    this.flatReads = flatten(this.statements);
    return this.flatReads;
  }
  private resets: string[] | null = null;
  getResets(): string[] {
    if (this.resets !== null) {
      return this.resets;
    }
    this.resets = [];
    if (!this.isRegisterProcess()) {
      return this.resets;
    }
    for (const statement of this.statements) {
      if (statement instanceof OIf) {
        for (const clause of statement.clauses) {
          if (clause.condition.match(/res/i)) {
            for (const subStatement of clause.statements) {
              if (subStatement instanceof OAssignment) {
                this.resets = this.resets.concat(subStatement.writes.map(write => write.text));
              }
            }
          }
        }
      }
    }
    return this.resets;
  }
}
export class OProcedureInstantiation extends ObjectBase {
  name: string;
  tokens: OToken[];
}
export class OForLoop extends ObjectBase {
  variable: OVariable; // TODO: FIX ME not string
  start: string;
  end: string;
  statements: OStatement[] = [];
}
export class OAssignment extends ObjectBase {
  writes: OWrite[] = [];
  reads: ORead[] = [];
}

export class OToken extends ODefitionable {
  public scope?: OArchitecture | OProcess | OEntity | OForLoop | OProcedure;
  constructor(public parent: ObjectBase, startI: number, endI: number, public text: string) {
    super(parent, startI, endI);
    if (this.text === 'i_PIOWaitReq') {
      // debugger;
    }
    let object: (OFile | ObjectBase) = this;

    yank: do {
      object = object.parent;
      if (object instanceof OArchitecture) {
        for (const signal of object.signals) {
          if (signal.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = signal;
            this.scope = object;
            signal.mentions.push(this);

            break yank;
          }
        }
        for (const func of object.functions) {
          if (func.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = func;
            this.scope = object;
            func.mentions.push(this);

            break yank;
          }
        }
        for (const type of object.types) {
          if (type.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = type;
            this.scope = object;
            type.mentions.push(this);

            break yank;
          }
          if (type instanceof OEnum) {
            for (const state of type.states) {
              if (state.name.text.toLowerCase() === text.toLowerCase()) {
                this.definition = state;
                this.scope = object;
                state.mentions.push(this);

                break yank;
              }
            }
          }
          if (type instanceof ORecord) {
            for (const child of type.children) {
              if (child.name.text.toLowerCase() === text.toLowerCase()) {
                this.definition = child;
                this.scope = object;
                child.mentions.push(this);

                break yank;
              }
            }
          }
        }
        if (object instanceof OForGenerate && object.variable.name.text.toLowerCase() === text.toLowerCase()) {
          this.definition = object.variable;
          this.scope = object;
          break yank;
        }
      } else if (object instanceof OFileWithEntity) {
        for (const signal of object.entity.signals) {
          if (signal.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = signal;
            signal.mentions.push(this);
            this.scope = object.entity;
            break yank;
          }
        }
        for (const type of object.entity.types) {
          if (type.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = type;
            type.mentions.push(this);
            this.scope = object.entity;
            break yank;
          }
        }
        for (const func of object.entity.functions) {
          if (func.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = func;
            this.scope = object.entity;
            func.mentions.push(this);

            break yank;
          }
        }
        for (const port of object.entity.ports) {
          if (port.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = port;
            this.scope = object.entity;
            port.mentions.push(this);

            break yank;
          }
        }
        for (const generic of object.entity.generics) {
          if (generic.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = generic;
            this.scope = object.entity;
            generic.mentions.push(this);

            break yank;
          }
        }
      } else if (object instanceof OProcess) {
        for (const variable of object.variables) {
          if (variable.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = variable;
            this.scope = object;
            variable.mentions.push(this);

            break yank;
          }
        }
      } else if (object instanceof OProcedure) {
        for (const variable of object.variables) {
          if (variable.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = variable;
            this.scope = object;
            variable.mentions.push(this);

            break yank;
          }
        }
        for (const port of object.ports) {
          if (port.name.text.toLowerCase() === text.toLowerCase()) {
            this.definition = port;
            this.scope = object;
            port.mentions.push(this);

            break yank;
          }
        }
      } else if (object instanceof OForLoop) {
        if (object.variable.name.text.toLowerCase() === text.toLowerCase()) {
          this.definition = object.variable;
          this.scope = object;
          object.variable.mentions.push(this);
          break yank;
        }
      }


    } while (!(object instanceof OFile));

  }
}
export class OWrite extends OToken {
}
export class ORead extends OToken {

}
// Read of Record element or something
export class OElementRead extends ORead {
  constructor(public parent: ObjectBase, startI: number, endI: number, public text: string) {
    super(parent, startI, endI, text);
  }
}
export class OMappingName extends ODefitionable {
  constructor(public parent: OMapping, startI: number, endI: number, public text: string) {
    super(parent, startI, endI);
  }



}
export class ParserError extends Error {
  constructor(message: string, public range: OIRange, public solution?: { message: string, edits: TextEdit[] }) {
    super(message);
  }
}
export enum MagicCommentType {
  Disable,
  Parameter,
  Todo
}
export class OMagicComment extends ObjectBase {
  constructor(public parent: OFile, public commentType: MagicCommentType, range: OIRange) {
    super(parent, range.start.i, range.end.i);
  }
}
export class OMagicCommentDisable extends OMagicComment {
  constructor(public parent: OFile, public commentType: MagicCommentType.Disable, range: OIRange) {
    super(parent, commentType, range);
  }
}
export class OMagicCommentTodo extends OMagicComment {
  public message: string;
  constructor(public parent: OFile, public commentType: MagicCommentType.Todo, range: OIRange, message: string) {
    super(parent, commentType, range);
    this.message = message;
  }
}
export class OMagicCommentParameter extends OMagicComment {
  constructor(public parent: OFile, public commentType: MagicCommentType.Parameter, range: OIRange, public parameter: string[]) {
    super(parent, commentType, range);
  }
}