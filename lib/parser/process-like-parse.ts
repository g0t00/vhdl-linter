import { AssignmentParser } from './assignment-parser';
import { ObjectBase, OStatement, OWhileLoop, OForLoop, OVariable, OName, OIf, OIfClause, OElseClause, OCase, OWhenClause, OAssignment, OProcedureCall, OPortMap, OProcedureCallPortMap, OMapping } from './objects';
import { ParserBase } from './parser-base';

export class ProcessLikeParser extends ParserBase {
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
        statements.push(this.parseWait(parent));
      } else if (nextWord.toLowerCase() === 'exit') {
        this.advancePast(';');
      } else if (nextWord.toLowerCase() === 'while') {
        statements.push(this.parseWhile(parent, label));
      } else if (statementText.match(/:=|<=/)) {
        const assignmentParser = new AssignmentParser(this.text, this.pos, this.file, parent);
        statements.push(assignmentParser.parse());
      } else {
        statements.push(this.parseProcedureCall(parent));

      }
    }
    return statements;
  }
  parseProcedureCall(parent: ObjectBase) {
    const procedureCall = new OProcedureCall(parent, this.pos.i, this.getEndOfLineI());
    procedureCall.procedureName = new OName(procedureCall, this.pos.i, this.pos.i);
    procedureCall.procedureName.text = this.getNextWord();
    procedureCall.procedureName.range.end.i = procedureCall.procedureName.range.start.i + procedureCall.procedureName.text.length;
    while (this.text[this.pos.i] === '.') {
      this.expect('.');
      procedureCall.procedureName.range.start.i = this.pos.i;
      procedureCall.procedureName.text = this.getNextWord();
      procedureCall.procedureName.range.end.i = procedureCall.procedureName.range.start.i + procedureCall.procedureName.text.length;

    }
    if (this.text[this.pos.i] === '(') {
      procedureCall.portMap = new OProcedureCallPortMap(procedureCall, this.pos.i, this.getEndOfLineI());
      this.expect('(');
      let startI = this.pos.i;
      let text = this.advanceBrace();
      procedureCall.portMap.range.end.i = this.pos.i;
      const matches = text.matchAll(/([^,]*)(,|$)/g);
      // console.log(text);
      for (const match of matches) {
        const map = new OMapping(procedureCall.portMap, startI + (match.index ?? 0), startI + (match.index ?? 0) + match[1].length);
        map.mappingIfInput = this.extractReads(map, match[1], startI + (match.index ?? 0));
        map.mappingIfOutput = this.extractReadsOrWrite(map, match[1], startI + (match.index ?? 0));
        procedureCall.portMap.children.push(map);
      }
    }
    procedureCall.range.end.i = this.pos.i;
    this.expect(';');
    return procedureCall;
  }
  parseWait(parent: ObjectBase) {
    this.expect('wait');
    let nextWord = this.getNextWord({consume: false});
    if (['until', 'on', 'for'].indexOf(nextWord.toLowerCase()) > -1) {
      this.getNextWord();
      let assignment = new OAssignment(parent, this.pos.i, this.getEndOfLineI());
      let rightHandSideI = this.pos.i;
      const rightHandSide = this.advanceSemicolon();
      assignment.reads.push(...this.extractReads(assignment, rightHandSide, rightHandSideI));
      assignment.range.end.i = this.pos.i;
      return assignment;
    } else {
      this.expect(';');
      let assignment = new OAssignment(parent, this.pos.i, this.getEndOfLineI());
      return assignment;
    }
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