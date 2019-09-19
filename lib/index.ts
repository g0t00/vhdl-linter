import { TextEditor, CompositeDisposable, Point } from 'atom';
import { VhdlLinter, Message } from './vhdl-linter';
import { ORead, OWrite } from './parser/objects';
import { Parser } from './parser/parser';
import { ProjectParser, OProjectEntity, OThing, OPackage } from './project-parser';
import { browser } from './viewer/browser';

module.exports = {
  subscriptions: CompositeDisposable,
  projectParser: ProjectParser,
  parser: Parser,
  activate(): void {
    //    console.log('activate', this);
    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();
    //    console.log(browser);
    // browser.getView();
    atom.workspace.addRightPanel({
      item: browser.getView()
    });
    // Register command that toggles this view
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'vhdl-linter:copy-parsed': () => {
        //        console.log('activat2e', this);
        const editor = atom.workspace.getActiveTextEditor();
        if (editor) {
           const parser = new Parser(editor.getText(), editor.getPath() || '');
          atom.clipboard.write(JSON.stringify(parser.parse().getJSONMagic()));
          atom.notifications.addInfo('copied tree');
        }
      }
    }));
    this.projectParser = new ProjectParser(this.subscriptions);
  },

  deactivate(): void {
    this.subscriptions.dispose();
  },

  provideLinter() {
    return {
      name: 'Vhdl-Linter',
      scope: 'file', // or 'project'
      lintsOnChange: true, // or true
      grammarScopes: ['source.vhdl'],
      async lint(textEditor: TextEditor): Promise<Message[]> {
        // console.log('lint', this);
        if (!module.exports.vhdlLinters) {
          module.exports.vhdlLinters = [];
        }
        module.exports.vhdlLinters[textEditor.getPath() || ''] = new VhdlLinter(textEditor.getPath() || '', textEditor.getText(), module.exports.projectParser);
        const messages = await module.exports.vhdlLinters[textEditor.getPath() || ''].checkAll();
        return messages;
      }
    };
  },

  provideHyper() {
    return {
      priority: 1,
      grammarScopes: ['source.vhdl'], // JavaScript files
      wordRegExp: /(entity\s+)?[a-z][\w.]*/ig,
      getSuggestionForWord: async (
        textEditor: TextEditor,
        text: string,
        range: any
      ) => {
//        console.log(text, range);
        const match = text.match(/^(entity\s+)(\w+)\.(\w+)/i);
        if (!match) {
//          console.log('path', textEditor.getPath());
          const linter = module.exports.vhdlLinters[textEditor.getPath() || ''] as VhdlLinter;
//          console.log('linter', linter);
          let result: any;
          // try {
            const startIRegex = new RegExp(`^(.*\n){${range.start.row}}.{${range.start.column}}`, 'g');
            const match2 = textEditor.getText().match(startIRegex);
            if (!match2) {
//              console.log('match not found');
              return;
            }
            const startI = match2[0].length;
            const foundThing = linter.tree.objectList.find(obj => {
              if (obj instanceof ORead || obj instanceof OWrite) {
                return obj.begin === startI;
              } else {
                return false;
              }
            });
            if (!foundThing || !(foundThing instanceof ORead || foundThing instanceof OWrite)) {
//              console.log('foundThing not foundThing', foundThing, startI);
              return;
            }
            const packageThings: OThing[] = [];
            module.exports.projectParser.packages.forEach((pkg: OPackage) => packageThings.push(... pkg.things));
            result = linter.tree.architecture.findRead(foundThing, packageThings);
//           } catch (e) {
// //            console.log(e);
//           }
//          console.log('reads', result);
          if (typeof result === 'boolean') {
            return;
          }
          return {
            range,
            callback() {
//              console.log('callback false');
              const editor = atom.workspace.getActiveTextEditor();
              if (!editor) {
                return;
              }
              if (result instanceof OThing) {
                atom.workspace.open(result.parent.path).then(() => {
                  const editor = atom.workspace.getActiveTextEditor();
                  if (!editor) {
                    return;
                  }
                  let row = 0;
                  let col = 0;
                  const text = editor.getText();
                  for (let count = 0; count < result.startI; count++) {
                    if (text[count] === '\n') {
                      row++;
                      col = 0;
                    } else {
                      col++;
                    }
                  }
                  editor.setCursorBufferPosition(new Point(row, col), {autoscroll: false});
                  editor.scrollToCursorPosition({center: true});
                });
              } else {
                let pos = linter.getPositionFromI(result.startI);
                editor.setCursorBufferPosition(pos, {autoscroll: false});
                editor.scrollToCursorPosition({center: true});
              }
              // atom.workspace.open(entities[0].file.getPath());
            },
          };
        }
        const [, whatever, library, entityName] = match;
        const entities = (await this.projectParser.getEntities()).filter((entity: OProjectEntity) => {
          return entity.name === entityName && (entity.library ? entity.library === library : true);
        });
        return {
          range,
          callback() {
//            console.log('callback', entities);
            atom.workspace.open(entities[0].file.getPath());
          },
        };
      },
    };
  }
};
