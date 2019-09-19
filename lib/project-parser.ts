import { Directory, File, CompositeDisposable } from 'atom';
import { LiteEvent } from 'lite-event';

export class ProjectParser {
  private cachedFiles: OFileCache[] = [];
  private packages: OPackage[];
  private entities: OProjectEntity[];
  private initialized = false;
  private initEvent = new LiteEvent();
  constructor(public subscriptions: CompositeDisposable) {
    this.initialize().then(() => {
      this.initEvent.trigger();
    });
  }
  private async parseDirectory (directory: Directory): Promise<File[]> {
    const files = [];
    const entries = await new Promise((resolve, reject) => directory.getEntries((err, entries) => {
      if (err) {
        return reject(err);
      }
      resolve(entries);
    })) as (Directory|File)[];
    // const entries = await promisify(directory.getEntries)()
    for (const entry of entries) {
      if (entry instanceof File) {
        if (entry.getBaseName().match(/\.vhdl?$/i)) {
          files.push(entry);
        }
      } else {
        files.push(... await this.parseDirectory(entry));
      }
    }
    return files;
  }
  private fetchEntitesAndPackages() {
//     console.log(this.cachedFiles);
    this.packages = [];
    this.entities = [];
    for (const cachedFile of this.cachedFiles) {
      if (cachedFile.entity) {
        this.entities.push(cachedFile.entity);
      }
      if (cachedFile.package) {
        this.packages.push(cachedFile.package);
      }
    }
  }
  private async initialize(): Promise<void> {
    let files: File[] = [];
    for (const directory of atom.project.getDirectories()) {
      files.push(... await this.parseDirectory(directory));
    }
    const pkg = atom.packages.getPackageDirPaths() + '/vhdl-linter';
    if (pkg) {
//       console.log(pkg, new Directory(pkg + '/ieee2008'));
      files.push(... await this.parseDirectory(new Directory(pkg + '/ieee2008')));
    }
    for (const file of files) {
      let cachedFile = this.cachedFiles.find(cachedFile => cachedFile.path === file.getPath());
      // if (cachedFile && cachedFile.digest !== await file.getDigest()) {
      //   cachedFile.parsePackage(file);
      // }
      if (!cachedFile) {
        let cachedFile = new OFileCache();
        cachedFile.path = file.getPath();
        await cachedFile.parseFile(file);
        this.cachedFiles.push(cachedFile);
      }
    }
    this.fetchEntitesAndPackages();
    this.subscriptions.add(atom.project.onDidChangeFiles(async events => {
      for (const event of events) {
        if (event.path.match(/\.vhdl?$/i)) {
//           // console.log(event);
          if (event.action === 'created') {
            let cachedFile = new OFileCache();
            cachedFile.path = event.path;
            await cachedFile.parseFile(new File(event.path));
            this.cachedFiles.push(cachedFile);
          } else if (event.action === 'deleted') {
            const index = this.cachedFiles.findIndex(cachedFile => cachedFile.path === event.path);
            this.cachedFiles.splice(index, 1);
          } else if (event.action === 'modified') {
//             console.log(this.cachedFiles);
            const cachedFile = this.cachedFiles.find(cachedFile => cachedFile.path === event.path);
            if (cachedFile) {
              await cachedFile.parseFile(new File(event.path));
            } else {
              console.error('modified file not found', event);
            }
          } else if (event.action === 'renamed') {
            const cachedFile = this.cachedFiles.find(cachedFile => cachedFile.path === event.oldPath);
            if (cachedFile) {
              await cachedFile.parseFile(new File(event.path));
            } else {
              console.error('renamed file not found', event);
            }

          }
          this.fetchEntitesAndPackages();
        }
      }
    }));
    this.initialized = true;
  }
  public async getPackages(): Promise<OPackage[]> {
    if (this.initialized) {
      return this.packages;
    }
    await new Promise(resolve => {
      this.initEvent.on((_arg1, _arg2) => {
        resolve();
      });
    });
    return this.packages;
  }
  public async getEntities(): Promise<OProjectEntity[]> {
    if (this.initialized) {
      return this.entities;
    }
    await new Promise(resolve => {
      this.initEvent.on((_arg1, _arg2) => {
        resolve();
      });
    });
    return this.entities;
  }
}
export class OPackage {
  constructor (public path: string, public name: string) {}
  things: OThing[] = [];
  referencePackage?: string;
}
export class OThing {
  constructor (public parent: OPackage, public name: string, public startI: number) {}
}
export class OProjectPorts {
  name: string;
  direction: 'in' | 'out' | 'inout';
  hasDefault: boolean;
}
export class OProjectEntity {
  ports: OProjectPorts[] = [];
  name: string;
  library?: string;
  file: File;
}
export class OFileCache {
  path: string;
  digest: string;
  package?: OPackage;
  entity?: OProjectEntity;
  private text: string;

  async parseFile(file: File): Promise<void> {
    const text = await file.read();
    if (!text) {
      return;
    }
    this.text = text;
    this.digest = await file.getDigest();
    this.path = file.getPath();
    this.parsePackage();
    this.parseEntity(file);
  }
  private parsePackage(): void {
    const match = this.text.match(/package\s+(\w+)\s+is/i);
    if (!match) {
      return;
    }
    this.package = new OPackage(this.path, match[1]);
    // console.log(  this.package.name, 'parsing package');

    let re = /constant\s+(\w+)/g;
    let m: RegExpExecArray|null;
    while (m = re.exec(this.text)) {
      this.package.things.push(new OThing(this.package, m[1], m.index));
    }
    re = /function\s+(\w+)/g;
    while (m = re.exec(this.text)) {
      this.package.things.push(new OThing(this.package, m[1], m.index));
    }
    re = /(?:subtype|type)\s+(\w+)/g;
    while (m = re.exec(this.text)) {
      this.package.things.push(new OThing(this.package, m[1], m.index));
    }
    re = /type\s+(\w+)\s+is\s*\(([^)]*)\)\s*;/g;
    while (m = re.exec(this.text)) {
      let j = m.index;
      const pkg = this.package;
      this.package.things.push(... m[2].split(',').map(thing => {
        const thing2 = new OThing(pkg, thing.trim(), j);
        j += 1 + thing.length;
        return thing2;
      }));
    }
    const matchReference = this.text.match(/is\s+new\s+(\w+).(\w+)/i);
    if (matchReference) {
      this.package.referencePackage = matchReference[2];
    }

  }
  private parseEntity(file: File): void {
    const match = this.text.match(/entity\s+(\S+)\s+is/i);
    if (!match) {
      return;
    }
    this.entity = new OProjectEntity();
    this.entity.name = match[1];
    this.entity.file = file;
    let re = /(\S+)\s*:\s*(in|out|inout)\b(.*?:=.*)?/ig;
    let m;
    while (m = re.exec(this.text)) {
      const direction = m[2].toLowerCase();
      if (direction === 'in' || direction === 'inout' || direction === 'out') {
        const port = new OProjectPorts();
        port.name = m[1];
        port.direction = direction;
        port.hasDefault = typeof m[3] !== 'undefined';
        this.entity.ports.push(port);
      }
    }
    let libraryMatch = this.text.match(/--!\s*@library\s+(\S+)/i);
    if (libraryMatch) {
      this.entity.library = libraryMatch[1];
    }
  }
}
// type t_packet is (p_NONE, p_CM_REQ, p_CM_REJ, p_CM_REP, p_CM_RTU, p_CM_DREQ, p_CM_DREP, p_RC_MR, p_RC_SIZE, p_RC_DECLINE, p_RDMA_F, p_RDMA_M, p_RDMA_L, p_RDMA_O, p_ACK);
