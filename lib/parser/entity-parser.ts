import { ParserBase } from './parser-base';
import { DeclarativePartParser } from './declarative-part-parser';
import { OPort, OGeneric, OEntity, ParserError, OFileWithEntity, OGenericActual, OGenericType, OI, OIRange, OName } from './objects';
import { runInThisContext } from 'vm';
import { AssignmentParser } from './assignment-parser';
import { StatementParser, StatementTypes } from './statement-parser';

export class EntityParser extends ParserBase {
  public entity: OEntity;
  constructor(text: string, pos: OI, file: string, private parent: OFileWithEntity) {
    super(text, pos, file);
    const match = this.parent.originalText.match(/!\s*@library\s+(\S+)/i);
    const library = match ? match[1] : undefined;
    this.entity = new OEntity(this.parent, this.pos.i, this.getEndOfLineI(), library);
    this.debug(`start`);
  }
  parse(): OEntity {
    this.entity.name = this.getNextWord();
    this.expect('is');

    let lastI;
    while (this.pos.i < this.text.length) {
      if (this.text[this.pos.i].match(/\s/)) {
        this.pos.i++;
        continue;
      }
      let nextWord = this.getNextWord({ consume: false }).toLowerCase();
      const savedI = this.pos.i;
      if (nextWord === 'port') {
        this.getNextWord();
        this.entity.ports = this.parsePortsAndGenerics(false, this.entity);
        this.entity.portRange = new OIRange(this.entity, savedI, this.pos.i);
        this.expect(';');
      } else if (nextWord === 'generic') {
        this.getNextWord();
        this.entity.generics = this.parsePortsAndGenerics(true, this.entity);
        this.entity.genericRange = new OIRange(this.entity, savedI, this.pos.i);
        this.expect(';');
      } else if (nextWord === 'end') {
        this.getNextWord();
        this.maybeWord('entity');
        this.maybeWord(this.entity.name);
        this.expect(';');
        break;
      } else if (nextWord === 'begin') {
        this.getNextWord();
        let nextWord = this.getNextWord({consume: false}).toLowerCase();
        while (nextWord !== 'end') {
          new StatementParser(this.text, this.pos, this.file, this.entity).parse([
            StatementTypes.Assert,
            StatementTypes.ProcedureInstantiation,
            StatementTypes.Process
          ]);
          nextWord = this.getNextWord({ consume: false }).toLowerCase();
        }
        this.getNextWord();
        this.maybeWord('entity');
        this.maybeWord(this.entity.name);
        this.expect(';');
        break;

      } else {
        new DeclarativePartParser(this.text, this.pos, this.file, this.entity).parse(true);
      }
      if (lastI === this.pos.i) {
        throw new ParserError(`Parser stuck on line ${this.getLine} in module ${this.constructor.name}`, this.pos.getRangeToEndLine());
      }
      lastI = this.pos.i;
    }
    this.entity.range.end.i = this.pos.i;

    return this.entity;
  }


}
