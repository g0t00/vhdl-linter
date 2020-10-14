import { ParserBase } from './parser-base';
import { AssignmentParser } from './assignment-parser';

import { OProcess, OStatement, OForLoop, OIf, OIfClause, OCase, OWhenClause, OVariable, ORead, ObjectBase, OI, OElseClause, OName, OWhileLoop } from './objects';
import { tokenizer } from './tokenizer';
import { ProcessLikeParser } from './process-like-parse';

export class ProcessParser extends ProcessLikeParser {
  constructor(text: string, pos: OI, file: string, private parent: ObjectBase) {
    super(text, pos, file);
    this.debug(`start`);

  }
  parse(startI: number, label?: string): OProcess {
    const process = new OProcess(this.parent, startI, this.getEndOfLineI());
    if (this.text[this.pos.i] === '(') {
      this.expect('(');
      process.label = label;
      process.sensitivityList = this.advanceBrace();
    }
    this.maybeWord('is');
    let nextWord = this.getNextWord({ consume: false }).toLowerCase();
    while (nextWord !== 'begin') {
      const variable = new OVariable(process, this.pos.i, this.getEndOfLineI());
      variable.constant = false;
      const alias = this.getNextWord({ consume: false }).toLowerCase() === 'alias';
      this.expect(['variable', 'file', 'alias']);
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
      if (alias) {
        this.advanceSemicolon(true);
      } else {
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
        process.variables.push(variable);

      }
      multiSignals = [];
      nextWord = this.getNextWord({ consume: false }).toLowerCase();
    }
    this.expect('begin');
    process.statements = this.parseStatements(process, ['end']);
    this.expect('end');
    this.expect('process');
    if (label) {
      this.maybeWord(label);
    }
    process.range.end.i = this.pos.i;
    this.expect(';');
    return process;
  }
}
