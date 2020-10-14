import { ParserBase } from './parser-base';
import { AssignmentParser } from './assignment-parser';

import { OProcess, OStatement, OForLoop, OIf, OIfClause, OCase, OWhenClause, OVariable, ORead, ObjectBase, OI, OElseClause, OName, OProcedure, OWhileLoop } from './objects';
import { tokenizer } from './tokenizer';
import { ProcessLikeParser } from './process-like-parse';

export class ProcedureParser extends ProcessLikeParser {
  constructor(text: string, pos: OI, file: string, private parent: ObjectBase) {
    super(text, pos, file);
    this.debug(`start`);

  }
  parse(startI: number, label?: string): OProcedure {
    const beforeNameI = this.pos.i;
    const name = this.getNextWord();
    const procedure = new OProcedure(this.parent, startI, this.getEndOfLineI());
    procedure.name = new OName(procedure, beforeNameI, beforeNameI + name.length);
    procedure.name.text = name;

    if (this.text[this.pos.i] === '(') {
      // this.expect('(');
      procedure.ports = this.parsePortsAndGenerics(false, procedure);
    } else {
      procedure.parameter = '';
    }
    let nextWord = this.getNextWord({consume: false});
    if (nextWord === 'is') {
      this.expect('is');
      // debugger;
      nextWord = this.getNextWord({ consume: false }).toLowerCase();
      while (nextWord !== 'begin') {
        const variable = new OVariable(procedure, this.pos.i, this.getEndOfLineI());
        variable.constant = false;
        this.expect('variable');
        const startI = this.pos.i;
        const name = this.getNextWord();
        variable.name = new OName(variable, startI, startI + name.length);
        variable.name.text = name;
        let multiSignals: string[] = []; // TODO: Fix this!!
        if (this.text[this.pos.i] === ',') {
          // multiSignals.push(name);
          this.expect(',');

          continue;
        }
        this.expect(':');
        const startType = this.pos.i;
        const { typeReads, defaultValueReads } = this.getType(variable);
        variable.type = typeReads;
        variable.defaultValue = defaultValueReads;

        // for (const multiSignalName of multiSignals) {
        //   const multiSignal = new OVariable(process, -1, -1);
        //   Object.assign(variable, multiSignal);
        //   multiSignal.name = multiSignalName;
        //   process.variables.push(multiSignal);
        // }
        procedure.variables.push(variable);
        multiSignals = [];
        nextWord = this.getNextWord({ consume: false }).toLowerCase();
      }
      this.expect('begin');
      procedure.statements = this.parseStatements(procedure, ['end']);
      this.expect('end');
      this.expect('procedure');
      this.maybeWord(name);
      procedure.range.end.i = this.pos.i;

    }
    this.expect(';');

    return procedure;
  }

}
