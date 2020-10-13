import { ParserBase } from './parser-base';
import { AssignmentParser } from './assignment-parser';

import { OProcess, OStatement, OForLoop, OIf, OIfClause, OCase, OWhenClause, OVariable, ORead, ObjectBase, OI, OElseClause, OName, OProcedure, OWhileLoop } from './objects';
import { tokenizer } from './tokenizer';

export class ProcedureParser extends ParserBase {
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
      this.expect('(');
      procedure.parameter = this.advanceBrace();
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
  parseStatements(parent: ObjectBase, exitConditions: string[]): OStatement[] {
    const statements = [];
    while (this.pos.i < this.text.length) {
      let nextWord = this.getNextWord({ consume: false });
      let label;
      if (this.text.substr(this.pos.i + nextWord.length).match(/^\s*:(?!=)/)) {
        label = nextWord;
        this.getNextWord(); // consume label
        this.expect(':');
        nextWord = this.getNextWord({ consume: false });
      }
      const statementText = this.advanceSemicolon(true, { consume: false });
      if (nextWord.toLowerCase() === 'if') {
        statements.push(this.parseIf(parent, label));
      } else if (exitConditions.indexOf(nextWord.toLowerCase()) > -1) {
        break;
      } else if (nextWord.toLowerCase() === 'case') {
        this.getNextWord();
        statements.push(this.parseCase(parent, label));
      } else if (nextWord.toLowerCase() === 'for') {
        statements.push(this.parseFor(parent, label));
      } else if (nextWord.toLowerCase() === 'report') {
        this.advancePast(';');
      } else if (nextWord.toLowerCase() === 'assert') {
        this.advancePast(';');
      } else if (nextWord.toLowerCase() === 'wait') {
        this.advancePast(';');
      } else if (nextWord.toLowerCase() === 'exit') {
        this.advancePast(';');
      } else if (nextWord.toLowerCase() === 'while') {
        statements.push(this.parseWhile(parent, label));
      } else if (statementText.match(/:=|<=/)) {
        const assignmentParser = new AssignmentParser(this.text, this.pos, this.file, parent);
        statements.push(assignmentParser.parse());
      } else {
        this.advanceSemicolon(true);
      }
    }
    return statements;
  }
  parseWhile(parent: ObjectBase, label?: string): OWhileLoop {
    const whileLoop = new OWhileLoop(parent, this.pos.i, this.getEndOfLineI());
    this.expect('while');
    const startI = this.pos.i;
    const position = this.pos.i;
    const condition = this.advancePast('loop');
    whileLoop.conditionReads = this.extractReads(whileLoop, condition, position);
    whileLoop.statements = this.parseStatements(whileLoop, ['end']);
    this.expect('end');
    this.expect('loop');
    if (label) {
      this.maybeWord(label);
    }
    this.expect(';');
    return whileLoop;
  }
  parseFor(parent: ObjectBase, label?: string): OForLoop {
    const forLoop = new OForLoop(parent, this.pos.i, this.getEndOfLineI());
    this.expect('for');
    const startI = this.pos.i;
    const variableName = this.getNextWord();
    forLoop.variable = new OVariable(forLoop, startI, variableName.length + startI);
    forLoop.variable.name = new OName(forLoop.variable, startI, variableName.length + startI);
    forLoop.variable.name.text = variableName;
    this.expect('in');
    // forLoop.start = this.getNextWord();
    forLoop.start = this.advancePast(/\b(?:downto|to)\b/i).trim();
    // this.expect(['downto', 'to']);
    forLoop.end = this.advancePast('loop').trim();
    forLoop.statements = this.parseStatements(forLoop, ['end']);
    this.expect('end');
    this.expect('loop');
    if (label) {
      this.maybeWord(label);
    }
    this.expect(';');
    return forLoop;
  }
  parseIf(parent: ObjectBase, label?: string): OIf {
    this.debug(`parseIf`);

    const if_ = new OIf(parent, this.pos.i, this.getEndOfLineI());
    const clause = new OIfClause(if_, this.pos.i, this.getEndOfLineI());
    this.expect('if');
    const position = this.pos.i;
    clause.condition = this.advancePast('then');
    clause.conditionReads = this.extractReads(clause, clause.condition, position);
    clause.statements = this.parseStatements(clause, ['else', 'elsif', 'end']);
    clause.range.setEndBacktraceWhitespace(this.pos.i);
    if_.clauses.push(clause);
    let nextWord = this.getNextWord({ consume: false }).toLowerCase();
    while (nextWord === 'elsif') {
      const clause = new OIfClause(if_, this.pos.i, this.getEndOfLineI());

      this.expect('elsif');
      const position = this.pos.i;
      clause.condition = this.advancePast('then');
      clause.conditionReads = this.extractReads(clause, clause.condition, position);
      clause.statements = this.parseStatements(clause, ['else', 'elsif', 'end']);
      clause.range.setEndBacktraceWhitespace(this.pos.i);
      if_.clauses.push(clause);
      nextWord = this.getNextWord({ consume: false }).toLowerCase();
    }
    if (nextWord === 'else') {
      this.expect('else');
      if_.else = new OElseClause(if_, this.pos.i, this.pos.i);
      if_.else.statements = this.parseStatements(if_, ['end']);
      if_.else.range.setEndBacktraceWhitespace(this.pos.i);

    }
    this.expect('end');
    this.expect('if');
    if (label) {
      this.maybeWord(label);
    }
    this.expect(';');

    return if_;
  }
  parseCase(parent: ObjectBase, label?: string): OCase {
    this.debug(`parseCase ${label}`);
    const case_ = new OCase(parent, this.pos.i, this.getEndOfLineI());
    const posI = this.pos.i;
    case_.variable = this.extractReads(case_, this.advancePast(/\bis\b/i), posI);
    // this.debug(`Apfel`);

    let nextWord = this.getNextWord().toLowerCase();
    while (nextWord === 'when') {
      this.debug(`parseWhen`);
      const whenClause = new OWhenClause(case_, this.pos.i, this.getEndOfLineI());
      const pos = this.pos.i;
      whenClause.condition = this.extractReads(whenClause, this.advancePast('=>'), pos);
      whenClause.statements = this.parseStatements(whenClause, ['when', 'end']);
      whenClause.range.setEndBacktraceWhitespace(this.pos.i);
      case_.whenClauses.push(whenClause);
      nextWord = this.getNextWord().toLowerCase();
    }
    this.expect('case');
    if (label) {
      this.maybeWord(label);
    }
    this.expect(';');
    this.debug(`parseCaseDone ${label}`);

    return case_;
  }
}
